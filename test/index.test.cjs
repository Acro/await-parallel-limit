'use strict'

const assert = require('assert')
const parallel = require('../dist/index').default
const { parallel: named, DEFAULT_CONCURRENCY } = require('../dist/index')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let passed = 0
const tests = []
const test = (name, fn) => tests.push([name, fn])

/**
 * Build a set of jobs that record the peak number of concurrently running jobs,
 * so tests can assert the limit is actually respected.
 */
const makeTrackedJobs = (count, work = () => delay(10)) => {
  const state = { active: 0, peak: 0 }
  const jobs = Array.from({ length: count }, (_, i) => async () => {
    state.active++
    state.peak = Math.max(state.peak, state.active)
    await work(i)
    state.active--
    return i
  })
  return { jobs, state }
}

test('exports a default and a named function plus the default constant', () => {
  assert.strictEqual(typeof parallel, 'function')
  assert.strictEqual(named, parallel)
  assert.strictEqual(DEFAULT_CONCURRENCY, 5)
})

test('returns results in input order, not completion order', async () => {
  const jobs = [
    async () => { await delay(30); return 'a' },
    async () => { await delay(5); return 'b' },
    async () => { await delay(15); return 'c' },
  ]
  const results = await parallel(jobs, 3)
  assert.deepStrictEqual(results, ['a', 'b', 'c'])
})

test('never exceeds the requested concurrency limit', async () => {
  const { jobs, state } = makeTrackedJobs(20)
  const results = await parallel(jobs, 4)
  assert.strictEqual(state.peak, 4)
  assert.deepStrictEqual(results, Array.from({ length: 20 }, (_, i) => i))
})

test('sustains max concurrency: replaces a finished job immediately, no batching', async () => {
  // Deferred promises let us control exactly when each job resolves, so this
  // test is fully deterministic (no reliance on real-timer timing).
  const makeDeferred = () => {
    let resolve
    const promise = new Promise((r) => { resolve = r })
    return { promise, resolve }
  }
  // Yield a macrotask so all pending worker continuations (microtasks) run.
  const flush = () => new Promise((r) => setTimeout(r, 0))

  const deferreds = Array.from({ length: 4 }, makeDeferred)
  const started = []
  let active = 0
  let peak = 0
  const jobs = deferreds.map((d, i) => async () => {
    active++
    peak = Math.max(peak, active)
    started.push(i)
    await d.promise
    active--
    return i
  })

  const done = parallel(jobs, 2)
  await flush()
  // Only the first two jobs start; the pool is full.
  assert.deepStrictEqual(started, [0, 1])
  assert.strictEqual(active, 2)

  // Finish ONLY job 0. Job 1 is still running. A true sliding pool must start
  // job 2 right away; a batching impl would wait for job 1 to finish too.
  deferreds[0].resolve()
  await flush()
  assert.deepStrictEqual(started, [0, 1, 2], 'job 2 should start the instant job 0 frees a slot')
  assert.strictEqual(active, 2, 'concurrency stays pinned at the limit')

  // Finish job 1 -> job 3 slots in immediately.
  deferreds[1].resolve()
  await flush()
  assert.deepStrictEqual(started, [0, 1, 2, 3])
  assert.strictEqual(active, 2)

  // Drain the tail.
  deferreds[2].resolve()
  deferreds[3].resolve()
  const results = await done
  assert.deepStrictEqual(results, [0, 1, 2, 3])
  assert.strictEqual(peak, 2, 'never exceeded the limit')
})

test('defaults to a concurrency of 5 when the limit is omitted', async () => {
  const { jobs, state } = makeTrackedJobs(12)
  await parallel(jobs)
  assert.strictEqual(state.peak, 5)
})

test('treats non-positive / non-integer limits as the default', async () => {
  for (const bad of [0, -1, 2.5, NaN]) {
    const { jobs, state } = makeTrackedJobs(12)
    await parallel(jobs, bad)
    assert.strictEqual(state.peak, 5, `limit ${bad} should fall back to 5`)
  }
})

test('does not start more workers than there are jobs', async () => {
  const { jobs, state } = makeTrackedJobs(2)
  await parallel(jobs, 100)
  assert.strictEqual(state.peak, 2)
})

test('resolves to an empty array for empty input', async () => {
  const results = await parallel([], 3)
  assert.deepStrictEqual(results, [])
})

test('propagates the first rejection (Promise.all semantics)', async () => {
  const jobs = [
    async () => { await delay(10); return 1 },
    async () => { throw new Error('boom') },
    async () => { await delay(10); return 3 },
  ]
  await assert.rejects(() => parallel(jobs, 2), /boom/)
})

test('throws synchronously-ish when jobs is not an array', async () => {
  await assert.rejects(() => parallel({}, 2), /First argument is not an array/)
})

test('handles many jobs without deep recursion', async () => {
  const { jobs, state } = makeTrackedJobs(1000, () => delay(0))
  const results = await parallel(jobs, 8)
  assert.strictEqual(results.length, 1000)
  assert.strictEqual(state.peak, 8)
  assert.strictEqual(results[999], 999)
})

;(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn()
      passed++
      console.log(`  ✓ ${name}`)
    } catch (err) {
      console.error(`  ✗ ${name}`)
      console.error(err && err.stack ? err.stack : err)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed}/${tests.length} tests passed`)
})()
