'use strict'

/**
 * Differential fuzzer. Generates seeded random scenarios (job counts, limits,
 * delays, failures, sync throws, aborts at random moments) and checks the
 * library against invariants and a per-job reference model:
 *
 *   1. peak in-flight never exceeds the effective limit
 *   2. no-failure, no-abort runs resolve to exactly the reference results, in order
 *   3. settle/mapSettled (no abort) resolve to exactly the per-job reference
 *      outcomes — each job's outcome is timing-independent, so this is exact
 *   4. fail-fast rejects with one of the injected errors, and no new jobs
 *      start after the rejection is delivered
 *   5. aborted runs either completed first (resolved) or reject with the abort
 *      reason, and no new jobs start after the rejection
 *
 * Run under --unhandled-rejections=strict so any stray rejection is fatal.
 * Usage: node --unhandled-rejections=strict test/fuzz.cjs [iterations] [seed]
 * On failure it prints the seed + scenario for exact reproduction.
 */

const assert = require('assert')
const { parallel, settle, map, mapSettled, DEFAULT_CONCURRENCY } = require('../dist/index')

const ITERATIONS = Number(process.argv[2]) || 300
const BASE_SEED = Number(process.argv[3]) || 0xC0FFEE

// xorshift32 — deterministic, seedable.
const prng = (seed) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 0x100000000
  }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const effectiveLimit = (limit) =>
  limit === Infinity ? Infinity :
  typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CONCURRENCY

const makeScenario = (rand) => {
  const variants = ['parallel', 'settle', 'map', 'mapSettled']
  const limits = [1, 2, 3, 5, 8, Infinity, 0, -2, 2.5, NaN, undefined]
  const n = Math.floor(rand() * 40)
  const scenario = {
    variant: variants[Math.floor(rand() * variants.length)],
    n,
    limit: limits[Math.floor(rand() * limits.length)],
    jobs: Array.from({ length: n }, (_, i) => ({
      delayMs: Math.floor(rand() * 4),
      fails: rand() < 0.08,
      syncThrow: rand() < 0.04,
      syncAborts: false,
    })),
    abort: 'none', // none | pre | timed | sync
    abortAfterMs: 0,
  }
  const roll = rand()
  if (roll < 0.1) scenario.abort = 'pre'
  else if (roll < 0.3) { scenario.abort = 'timed'; scenario.abortAfterMs = Math.floor(rand() * 12) }
  else if (roll < 0.38 && n > 0) { scenario.abort = 'sync'; scenario.jobs[Math.floor(rand() * n)].syncAborts = true }
  return scenario
}

const runScenario = async (scenario) => {
  const { variant, n, limit, jobs } = scenario
  const settleMode = variant === 'settle' || variant === 'mapSettled'
  const state = { active: 0, peak: 0, started: 0 }
  const controller = scenario.abort === 'none' ? null : new AbortController()
  if (scenario.abort === 'pre') controller.abort(new Error('PRE_ABORT'))

  const body = async (spec, i) => {
    state.started++
    state.active++
    state.peak = Math.max(state.peak, state.active)
    try {
      if (spec.delayMs) await delay(spec.delayMs)
      if (spec.fails) throw new Error(`FAIL_${i}`)
      return i * 2 + 1
    } finally {
      state.active--
    }
  }

  const thunkFor = (spec, i) => () => {
    if (spec.syncAborts && controller) controller.abort(new Error('SYNC_ABORT'))
    if (spec.syncThrow) throw new Error(`SYNC_${i}`)
    return body(spec, i)
  }

  const options = controller ? { signal: controller.signal } : undefined
  let promise
  if (variant === 'parallel') promise = parallel(jobs.map(thunkFor), limit, options)
  else if (variant === 'settle') promise = settle(jobs.map(thunkFor), limit, options)
  else {
    const mapper = (spec, i) => thunkFor(spec, i)()
    promise = variant === 'map' ? map(jobs, mapper, limit, options) : mapSettled(jobs, mapper, limit, options)
  }
  if (scenario.abort === 'timed') delay(scenario.abortAfterMs).then(() => controller.abort(new Error('TIMED_ABORT')))

  let outcome
  try {
    outcome = { resolved: true, value: await promise }
  } catch (err) {
    outcome = { resolved: false, error: err }
  }
  const startedAtSettle = state.started
  await delay(30) // long enough for any illegally-scheduled job to have started
  return { outcome, state, startedAtSettle }
}

const check = (scenario, { outcome, state, startedAtSettle }) => {
  const { n, limit, jobs } = scenario
  const settleMode = scenario.variant === 'settle' || scenario.variant === 'mapSettled'
  const lim = effectiveLimit(limit)

  // Invariant 1: concurrency ceiling.
  assert.ok(state.peak <= Math.min(lim, Math.max(n, 1)), `peak ${state.peak} > limit ${lim}`)

  // Invariant 4/5: nothing starts after the promise settles.
  assert.strictEqual(state.started, startedAtSettle, 'jobs started after the promise settled')

  const anyFailure = jobs.some((j) => j.fails || j.syncThrow)
  const reference = jobs.map((j, i) =>
    j.syncThrow || j.fails
      ? { status: 'rejected', message: j.syncThrow ? `SYNC_${i}` : `FAIL_${i}` }
      : { status: 'fulfilled', value: i * 2 + 1 })

  if (outcome.resolved) {
    // A resolved run must have executed everything: full, ordered, exact.
    if (settleMode) {
      assert.strictEqual(outcome.value.length, n)
      outcome.value.forEach((r, i) => {
        assert.strictEqual(r.status, reference[i].status, `settled[${i}] status`)
        if (r.status === 'fulfilled') assert.strictEqual(r.value, reference[i].value, `settled[${i}] value`)
        else assert.strictEqual(r.reason.message, reference[i].message, `settled[${i}] reason`)
      })
    } else {
      assert.ok(!anyFailure, 'fail-fast resolved despite an injected failure')
      assert.deepStrictEqual(outcome.value, reference.map((r) => r.value))
    }
  } else {
    const msg = outcome.error && outcome.error.message
    const legal =
      (scenario.abort !== 'none' && /ABORT/.test(msg)) ||
      (!settleMode && anyFailure && /^(FAIL|SYNC)_\d+$/.test(msg))
    assert.ok(legal, `illegal rejection: ${msg} (abort=${scenario.abort}, anyFailure=${anyFailure})`)
    if (settleMode) {
      assert.ok(scenario.abort !== 'none', 'settle mode rejected without an abort')
    }
  }
}

;(async () => {
  let failures = 0
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const seed = (BASE_SEED + iter * 2654435761) >>> 0
    const scenario = makeScenario(prng(seed))
    try {
      check(scenario, await runScenario(scenario))
    } catch (err) {
      failures++
      console.error(`\n✗ iteration ${iter} seed ${seed}`)
      console.error('  scenario:', JSON.stringify(scenario))
      console.error('  ', err.message)
      if (failures >= 5) break
    }
    if ((iter + 1) % 100 === 0) console.log(`  ${iter + 1}/${ITERATIONS} scenarios ok`)
  }
  if (failures) {
    console.error(`\nFUZZ FAILED: ${failures} scenario(s). Reproduce: node test/fuzz.cjs 1 <seed>`)
    process.exit(1)
  }
  console.log(`\nfuzz: ${ITERATIONS} randomized scenarios passed (base seed ${BASE_SEED.toString(16)})`)
})()
