'use strict'

const assert = require('assert')
const parallel = require('../dist/index').default
const { parallel: named, settle, map, mapSettled, DEFAULT_CONCURRENCY } = require('../dist/index')

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

// --- v3: options object (3rd positional arg) --------------------------------

test('parallel accepts an options object as the 3rd argument', async () => {
  const { jobs, state } = makeTrackedJobs(12)
  const results = await parallel(jobs, 4, {})
  assert.strictEqual(state.peak, 4)
  assert.strictEqual(results.length, 12)
})

// --- v3: settle() -----------------------------------------------------------

test('settle collects per-job outcomes in order and never rejects', async () => {
  const jobs = [
    async () => 'ok',
    async () => { throw new Error('bad') },
    async () => { await delay(5); return 42 },
  ]
  const results = await settle(jobs, 2)
  assert.strictEqual(results[0].status, 'fulfilled')
  assert.strictEqual(results[0].value, 'ok')
  assert.strictEqual(results[1].status, 'rejected')
  assert.strictEqual(results[1].reason.message, 'bad')
  assert.strictEqual(results[2].status, 'fulfilled')
  assert.strictEqual(results[2].value, 42)
})

test('settle respects the concurrency limit', async () => {
  const { jobs, state } = makeTrackedJobs(15)
  await settle(jobs, 3)
  assert.strictEqual(state.peak, 3)
})

// --- v3: map() / mapSettled() ----------------------------------------------

test('map applies a mapper with concurrency and preserves order', async () => {
  let active = 0
  let peak = 0
  const items = [1, 2, 3, 4, 5, 6, 7, 8]
  const results = await map(items, async (n, i) => {
    active++; peak = Math.max(peak, active)
    await delay(5)
    active--
    return `${i}:${n * 2}`
  }, 3)
  assert.strictEqual(peak, 3)
  assert.deepStrictEqual(results, ['0:2', '1:4', '2:6', '3:8', '4:10', '5:12', '6:14', '7:16'])
})

test('map supports synchronous mappers and fails fast', async () => {
  const doubled = await map([1, 2, 3], (n) => n * 2, 2)
  assert.deepStrictEqual(doubled, [2, 4, 6])
  await assert.rejects(() => map([1, 2, 3], (n) => { if (n === 2) throw new Error('x'); return n }, 2), /x/)
})

test('mapSettled collects per-item outcomes without rejecting', async () => {
  const results = await mapSettled([1, 2, 3], async (n) => {
    if (n === 2) throw new Error('nope')
    return n * 10
  }, 2)
  assert.deepStrictEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled'])
  assert.strictEqual(results[0].value, 10)
  assert.strictEqual(results[1].reason.message, 'nope')
  assert.strictEqual(results[2].value, 30)
})

test('map and mapSettled reject (not throw synchronously) on non-array input', async () => {
  for (const fn of [map, mapSettled]) {
    let threwSync = false
    let p
    try {
      p = fn({}, (x) => x, 2)
    } catch {
      threwSync = true
    }
    assert.strictEqual(threwSync, false, `${fn.name} must not throw synchronously`)
    await assert.rejects(p, /First argument is not an array/)
  }
})

test('stops starting new jobs after a fail-fast rejection', async () => {
  let started = 0
  const jobs = Array.from({ length: 10 }, (_, i) => async () => {
    started++
    if (i === 1) { await delay(5); throw new Error('boom') }
    await delay(15)
  })
  await assert.rejects(() => parallel(jobs, 2), /boom/)
  const startedAtRejection = started
  await delay(80) // long enough for stragglers to have started more if they were going to
  assert.strictEqual(started, startedAtRejection, 'no new jobs may start after rejection')
  assert.ok(started < 10, 'the remaining jobs should have been abandoned')
})

test('settle resolves to an empty array for empty input', async () => {
  assert.deepStrictEqual(await settle([], 3), [])
})

// --- v3: AbortSignal --------------------------------------------------------

test('rejects immediately when passed an already-aborted signal', async () => {
  const controller = new AbortController()
  controller.abort(new Error('too late'))
  const { jobs } = makeTrackedJobs(5)
  await assert.rejects(() => parallel(jobs, 2, { signal: controller.signal }), /too late/)
})

test('aborting mid-flight rejects and stops scheduling new jobs', async () => {
  const controller = new AbortController()
  let started = 0
  const jobs = Array.from({ length: 20 }, () => async () => {
    started++
    await delay(20)
  })
  const p = parallel(jobs, 3, { signal: controller.signal })
  await delay(25) // let the first wave run
  controller.abort(new Error('cancelled'))
  await assert.rejects(() => p, /cancelled/)
  const startedAtAbort = started
  await delay(60) // ensure no further jobs get scheduled after abort
  assert.strictEqual(started, startedAtAbort, 'no new jobs should start after abort')
  assert.ok(started < 20, 'should not have scheduled all jobs')
})

test('abort uses a default AbortError when no reason is given', async () => {
  const controller = new AbortController()
  const { jobs } = makeTrackedJobs(6, () => delay(15))
  const p = parallel(jobs, 2, { signal: controller.signal })
  await delay(5)
  controller.abort()
  await assert.rejects(() => p, (err) => err && err.name === 'AbortError')
})

test('settle also honours abort (cancellation is not a per-job outcome)', async () => {
  const controller = new AbortController()
  const jobs = Array.from({ length: 10 }, () => async () => { await delay(20) })
  const p = settle(jobs, 3, { signal: controller.signal })
  await delay(5)
  controller.abort(new Error('stop'))
  await assert.rejects(() => p, /stop/)
})

test('map honours abort', async () => {
  const controller = new AbortController()
  const p = map(Array.from({ length: 10 }, (_, i) => i), () => delay(20), 3, { signal: controller.signal })
  await delay(5)
  controller.abort(new Error('map cancelled'))
  await assert.rejects(() => p, /map cancelled/)
})

test('a non-aborted signal does not leak or interfere', async () => {
  const controller = new AbortController()
  const { jobs, state } = makeTrackedJobs(8)
  const results = await parallel(jobs, 4, { signal: controller.signal })
  assert.strictEqual(state.peak, 4)
  assert.strictEqual(results.length, 8)
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
