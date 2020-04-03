# await-parallel-limit

```javascript
npm install await-parallel-limit --save
```

Processes an array of async functions with concurrency limit (default limit is 5).

## API

```typescript
parallel(
	Array jobs,
	Integer concurrency,
)
```

## Typescript

```typescript
import parallel from 'await-parallel-limit'

const jobs = [
	async () { return await true },
	async () { return await 2 },
] as const

// results array is typed based on return types of async functions
// it is an ordered tuple of types

// const results: [ boolean, number ]
const results = await parallel(jobs, 2)
```

## Javascript

```javascript
const parallel = require('await-parallel-limit').default

var jobs = [
	async () { ... },
	async () { ... },
	async () { ... },
	async () { ... }
]

var results = await parallel(jobs, 2)
```