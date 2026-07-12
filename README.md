# await-parallel-limit

Run an array of async functions with a bounded number running concurrently.
Zero dependencies, first-class TypeScript types.

```bash
npm install await-parallel-limit --save
```

## Behaviour

- Runs at most `concurrency` jobs at a time (default `5`).
- Results are returned in **input order**, not completion order.
- If any job rejects, the returned promise rejects with the first error
  (same semantics as `Promise.all`). Jobs already in flight still run to
  completion, but their results are discarded.
- A `concurrency` value that is not a positive integer (e.g. `0`, `-1`, `2.5`)
  falls back to the default of `5`.

## API

```typescript
parallel<T>(
  jobs: Array<() => Promise<T>>,
  concurrency?: number, // default: 5
): Promise<T[]>
```

## TypeScript

```typescript
import parallel from 'await-parallel-limit'
// named import also available: import { parallel } from 'await-parallel-limit'

const jobs = [
  async () => true,
  async () => 2,
] as const

// When `jobs` is a readonly tuple (`as const`), the result is an ordered tuple
// typed from each job's return type:
//   const results: [boolean, number]
const results = await parallel(jobs, 2)
```

## JavaScript

```javascript
const parallel = require('await-parallel-limit').default

const jobs = [
  async () => { /* ... */ },
  async () => { /* ... */ },
  async () => { /* ... */ },
  async () => { /* ... */ },
]

const results = await parallel(jobs, 2)
```

## License

MIT
