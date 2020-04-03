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

## Usage

```typescript
import parallel from 'await-parallel-limit'

const jobs = [
	async () { ... },
	async () { ... },
	async () { ... },
	async () { ... }
] as const

// results array is typed based on return types of async functions
// it is an ordered tuple of types
const results = await parallel(jobs, 2)
```

```javascript
const parallel = require('await-parallel-limit')

var jobs = [
	async () { ... },
	async () { ... },
	async () { ... },
	async () { ... }
]

var results = await parallel(jobs, 2)
```