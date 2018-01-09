# await-parallel-limit

```javascript
npm install await-parallel-limit --save
```

Processes an array of async functions with concurrency limit (default limit is 5).

## API

```javascript
parallel(Array jobs, Integer concurrency)
```

## Usage

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