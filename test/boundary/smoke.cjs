'use strict'

/**
 * Package-boundary smoke test. Runs against the INSTALLED package
 * (`require('await-parallel-limit')`), not ../src or ../dist — CI packs the
 * tarball, installs it into a scratch consumer, copies this file in, and runs
 * it. Covers the flows a dependent actually exercises.
 */
const assert = require('assert')
const parallel = require('await-parallel-limit').default
const { parallel: named, settle, map, mapSettled, DEFAULT_CONCURRENCY } = require('await-parallel-limit')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  // Legacy dependent shape (@paperbits/core): thunks + integer limit, result discarded.
  let done = 0
  const tasks = []
  for (let i = 0; i < 12; i++) tasks.push(() => delay(3).then(() => { done++ }))
  await parallel(tasks, 30)
  assert.strictEqual(done, 12)

  // Exports.
  assert.strictEqual(named, parallel)
  assert.strictEqual(DEFAULT_CONCURRENCY, 5)

  // Ordering + concurrency ceiling.
  let active = 0, peak = 0
  const jobs = Array.from({ length: 20 }, (_, i) => async () => {
    active++; peak = Math.max(peak, active)
    await delay(i === 0 ? 25 : 4)
    active--
    return i
  })
  const ordered = await parallel(jobs, 4)
  assert.strictEqual(peak, 4)
  assert.deepStrictEqual(ordered, Array.from({ length: 20 }, (_, i) => i))

  // settle / map / mapSettled.
  const s = await settle([async () => 'ok', async () => { throw new Error('bad') }], 2)
  assert.deepStrictEqual(s.map((r) => r.status), ['fulfilled', 'rejected'])
  assert.deepStrictEqual(await map([1, 2, 3], async (n, i) => `${i}:${n * 2}`, 2), ['0:2', '1:4', '2:6'])
  const ms = await mapSettled([1, 2], async (n) => { if (n === 2) throw new Error('x'); return n }, 2)
  assert.deepStrictEqual(ms.map((r) => r.status), ['fulfilled', 'rejected'])

  // Abort: mid-flight and synchronous-from-a-job.
  const c1 = new AbortController()
  const p1 = parallel(Array.from({ length: 10 }, () => () => delay(20)), 2, { signal: c1.signal })
  await delay(5)
  c1.abort(new Error('cancelled'))
  await assert.rejects(() => p1, /cancelled/)

  const c2 = new AbortController()
  await assert.rejects(
    () => parallel([
      () => { c2.abort(new Error('sync stop')); return delay(5) },
      async () => 'b',
    ], 2, { signal: c2.signal }),
    /sync stop/,
  )

  // Fail-fast abandons unstarted work.
  let started = 0
  await assert.rejects(() => parallel(Array.from({ length: 10 }, (_, i) => async () => {
    started++
    if (i === 1) { await delay(3); throw new Error('boom') }
    await delay(10)
  }), 2), /boom/)
  const atReject = started
  await delay(40)
  assert.strictEqual(started, atReject)

  // Infinity = unbounded (2.x behaviour).
  let peakInf = 0, activeInf = 0
  await parallel(Array.from({ length: 9 }, () => async () => {
    activeInf++; peakInf = Math.max(peakInf, activeInf); await delay(5); activeInf--
  }), Infinity)
  assert.strictEqual(peakInf, 9)

  console.log('package-boundary smoke: all checks passed')
})().catch((err) => { console.error(err); process.exit(1) })
