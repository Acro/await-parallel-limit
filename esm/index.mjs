// Static ESM wrapper over the CJS build. Node's ESM loader gives a CJS module's
// `module.exports` as the default import, so without this wrapper
// `import parallel from 'await-parallel-limit'` would yield the exports object
// (Node ignores the `__esModule` marker). Re-exporting the same objects keeps a
// single implementation — no dual-package hazard.
import cjs from '../dist/index.js'

export default cjs.default
export const parallel = cjs.parallel
export const settle = cjs.settle
export const map = cjs.map
export const mapSettled = cjs.mapSettled
export const DEFAULT_CONCURRENCY = cjs.DEFAULT_CONCURRENCY
