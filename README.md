# await-parallel-limit

Run async work with a bounded number of tasks in flight at once.
Zero dependencies, first-class TypeScript types.

```bash
npm install await-parallel-limit --save
```

## Guarantees

- **Concurrency ceiling:** at most `concurrency` tasks are in flight at any
  moment (default `5`; `Infinity` means unbounded). A `concurrency` that is not
  a positive integer or `Infinity` (e.g. `0`, `-1`, `2.5`, `NaN`) falls back to
  the default of `5`.
- **Sustained concurrency:** when a task finishes, the next one starts
  immediately — a sliding worker pool, not fixed batches.
- **Ordering:** results are returned in **input order**, not completion order.
- **Fail-fast** (`parallel` / `map`): on the first rejection the returned
  promise rejects with that error (like `Promise.all`); no further tasks are
  started, and in-flight tasks run to completion but their results are
  discarded. Use `settle` / `mapSettled` to collect every outcome instead
  (like `Promise.allSettled`).
- **Abort** (`{ signal }`): an already-aborted signal rejects before any task
  starts; aborting mid-run — even synchronously from inside a task — rejects
  with the signal's `reason` and stops scheduling. The abort listener is always
  removed, so one long-lived signal can be reused across many runs.
- **No stray rejections:** after the returned promise settles, a still-running
  task that later rejects is absorbed — it never surfaces as an unhandled
  rejection.
- **Input snapshot:** the input array's length is captured at call time, so
  mutating the array mid-run cannot change the result set. Elements are read
  lazily at dispatch; don't mutate the input during a run.

These guarantees are enforced by the unit suite plus a seeded differential
fuzzer (`npm run fuzz`) and a package-boundary smoke test in CI.

## API

```typescript
type Options = { signal?: AbortSignal }

// Run an array of thunks, fail-fast, results in input order.
parallel<T>(jobs: Array<() => Promise<T>>, concurrency?: number, options?: Options): Promise<T[]>

// Like parallel, but never rejects on a failing job — returns per-job outcomes.
settle<T>(jobs: Array<() => Promise<T>>, concurrency?: number, options?: Options): Promise<SettledResult<T>[]>

// Map over data with a mapper, fail-fast, results in input order.
map<I, R>(items: I[], mapper: (item: I, index: number) => R | Promise<R>, concurrency?: number, options?: Options): Promise<R[]>

// Like map, but never rejects — returns per-item outcomes.
mapSettled<I, R>(items: I[], mapper: (item: I, index: number) => R | Promise<R>, concurrency?: number, options?: Options): Promise<SettledResult<R>[]>

type SettledResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: any }
```

All four functions are named exports; `parallel` is also the default export.

## Examples

```typescript
import parallel, { settle, map, mapSettled } from 'await-parallel-limit'

// 1. Array of thunks (ordered-tuple typing when declared `as const`).
const jobs = [
  async () => true,
  async () => 2,
] as const
const results = await parallel(jobs, 2) // const results: [boolean, number]

// 2. Map over data — no need to pre-build closures.
const bodies = await map(urls, (url) => fetch(url).then((r) => r.text()), 10)

// 3. Don't fail fast — inspect every outcome.
const outcomes = await mapSettled(urls, (url) => fetch(url), 10)
const failed = outcomes.filter((o) => o.status === 'rejected')

// 4. Cancel early with an AbortSignal.
const controller = new AbortController()
setTimeout(() => controller.abort(), 5000)
await parallel(jobs, 5, { signal: controller.signal })
```

## Importing

Both module systems are first-class (an `exports` map routes each to the right
entry — the ESM default import is the function, not a namespace object):

```javascript
// ESM
import parallel, { settle, map, mapSettled } from 'await-parallel-limit'

// CommonJS
const parallel = require('await-parallel-limit').default
const { settle, map, mapSettled } = require('await-parallel-limit')

const results = await parallel([
  async () => { /* ... */ },
  async () => { /* ... */ },
], 2)
```

## For AI agents

The npm tarball ships an [`llms.txt`](./llms.txt) — the complete API,
semantics, recipes, and gotchas in one compact file
(`node_modules/await-parallel-limit/llms.txt`). Contributors: see
[`AGENTS.md`](./AGENTS.md) for build/test/fuzz commands and the invariants
this package guarantees.

## Compatibility

`3.x` keeps the `2.x` API: the default export and the `parallel(jobs, limit)`
call shape are unchanged, and `settle`, `map`, `mapSettled`, and the `options`
argument are additive.

One deliberate behavioural change: after a fail-fast rejection, `3.x` stops
starting the remaining jobs. In `2.x`, surviving workers kept executing every
remaining job in the background even though the batch promise had already
rejected and the results were discarded. If you relied on those background side
effects, use `settle`, which always runs every job.

Requires Node >= 16.14. TypeScript consumers need TS >= 3.4 (the published
typings use `readonly` array syntax).

## License

MIT
