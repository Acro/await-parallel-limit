---
name: verify
description: Verify await-parallel-limit at its real surface — the npm package boundary (packed tarball installed into a fresh consumer), never via ./src imports.
---

# Verifying await-parallel-limit

Surface: the package boundary. Pack → install into a throwaway consumer → drive as a dependent would.

## Recipe

1. Build + pack: `npx tsc && npm pack --pack-destination <tmpdir>`
2. Fresh consumer: `mkdir <tmpdir>/consumer && cd there && npm init -y && npm i <tmpdir>/await-parallel-limit-<ver>.tgz`
3. Drive CJS: `require('await-parallel-limit').default` and named `{ parallel, settle, map, mapSettled, DEFAULT_CONCURRENCY }`.

## Flows worth driving

- Legacy dependent shape (`@paperbits/core`): `await parallel(thunks, 30)`, result discarded.
- Ordering (slow first job must still come back first) and peak-concurrency (active/peak counters in jobs).
- Abort: mid-flight, pre-aborted, **synchronous abort from inside a job during startup** (regression: must reject, not fulfill with holes), abort after completion (no-op), one signal reused across 30 runs (no MaxListeners warning).
- Fail-fast: after first rejection, started-count must not grow (remaining jobs abandoned).
- Garbage: non-array, junk limits (0, -1, 2.5, NaN, string, null → default 5), non-function array element (TypeError rejection), sparse arrays through map (holes → mapper gets undefined).
- TS surface: compile a consumer .ts against the *installed* d.ts. Floor is **TS 3.4** (`readonly I[]` in map/mapSettled signatures) — pin with `npm i --no-save typescript@3.4.5`.

## Gotchas

- Node ESM default import works via the `exports` map + `esm/index.mjs` wrapper. If `import parallel from` ever yields an object instead of a function, the exports map or wrapper broke — run `test/boundary/smoke.mjs` against the packed tarball.
- `tsc ... | head` masks the exit code — check `$?` on the tsc command itself, not the pipe.
- Scale check: 100k-item `map` should be O(10ms); if it regresses to O(100ms), per-item thunk allocation crept back in.
