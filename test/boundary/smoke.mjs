// ESM package-boundary smoke test: the default import must be the function,
// not the CJS exports object (the exports-map wrapper guarantees this).
import assert from 'assert'
import parallel, { parallel as named, settle, map, mapSettled, DEFAULT_CONCURRENCY } from 'await-parallel-limit'

assert.strictEqual(typeof parallel, 'function', 'ESM default import must be the function')
assert.strictEqual(named, parallel)
assert.strictEqual(DEFAULT_CONCURRENCY, 5)

const results = await parallel([async () => 'esm', async () => 'ok'], 2)
assert.deepStrictEqual(results, ['esm', 'ok'])

assert.deepStrictEqual(await map([1, 2, 3], (n) => n * 2, 2), [2, 4, 6])
const s = await settle([async () => 1, async () => { throw new Error('x') }], 2)
assert.deepStrictEqual(s.map((r) => r.status), ['fulfilled', 'rejected'])
const ms = await mapSettled([1], async (n) => n)
assert.strictEqual(ms[0].value, 1)

const c = new AbortController()
const p = parallel(Array.from({ length: 6 }, () => () => new Promise((r) => setTimeout(r, 20))), 2, { signal: c.signal })
setTimeout(() => c.abort(new Error('esm abort')), 5)
await assert.rejects(() => p, /esm abort/)

console.log('ESM package-boundary smoke: all checks passed')
