# await-parallel-limit

Run async work with a bounded number of tasks in flight at once.
Zero dependencies, first-class TypeScript types.

```bash
npm install await-parallel-limit --save
```

## Behaviour

- Runs at most `concurrency` tasks at a time (default `5`).
- Sustained concurrency: when a task finishes, the next one starts immediately —
  a sliding worker pool, not fixed batches.
- Results are returned in **input order**, not completion order.
- `parallel` / `map` fail fast: on the first rejection the returned promise
  rejects with that error (like `Promise.all`); in-flight tasks run to
  completion but their results are discarded. Use `settle` / `mapSettled` to
  collect every outcome instead (like `Promise.allSettled`).
- A `concurrency` that is not a positive integer (e.g. `0`, `-1`, `2.5`) falls
  back to the default of `5`.
- Optional `AbortSignal` cancels a run early.

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

## JavaScript (CommonJS)

```javascript
const parallel = require('await-parallel-limit').default
const { settle, map, mapSettled } = require('await-parallel-limit')

const results = await parallel([
  async () => { /* ... */ },
  async () => { /* ... */ },
], 2)
```

## Compatibility

`3.x` is a superset of `2.x`: the default export and the `parallel(jobs, limit)`
call shape are unchanged. `settle`, `map`, `mapSettled`, and the `options`
argument are additive. Upgrading from `2.x` requires no code changes.

## License

MIT
