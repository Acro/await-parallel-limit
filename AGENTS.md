# Agent guide — await-parallel-limit

Zero-dependency npm package: a concurrency-limited promise pool. ~230 lines of
TypeScript in `src/index.ts`; everything else is tests and packaging.

## Consumer API

See `llms.txt` (shipped in the npm tarball) for the complete API, semantics,
recipes, and gotchas in one file.

## Working on this repo

- Build: `npm run build` (tsc → `dist/`). `dist/` is git-ignored; `prepare`
  builds on install/publish.
- Test: `npm test` — builds, compiles `test/types.test.ts` (exact-type
  assertions; a wrong inference is a build failure), then runs the unit suite
  under `--unhandled-rejections=strict`.
- Fuzz: `npm run fuzz -- [iterations] [seed]` — seeded differential fuzzer
  (`test/fuzz.cjs`); failures print the seed for exact reproduction.
- Verify at the real surface: follow `.claude/skills/verify/SKILL.md` — pack
  the tarball, install into a fresh consumer, drive `require`/`import`
  `'await-parallel-limit'`. Never verify via `./src` imports.

## Architecture

One core, four one-line wrappers:

- `run(items, invoke, limit, settle, signal)` in `src/index.ts` — spawns up to
  `limit` workers pulling from a shared cursor; workers call
  `invoke(items[i], i)` directly (no per-item thunk allocation). A single
  `stopped` flag unifies fail-fast and abort cancellation.
- `parallel`/`settle` pass the jobs array + a call-the-thunk invoker;
  `map`/`mapSettled` pass the user's items + the mapper itself.
- ESM entry is a static wrapper (`esm/index.mjs`) re-exporting the CJS build —
  do NOT introduce a second compiled implementation (dual-package hazard).

## Invariants you must not break (enforced by tests + fuzzer + CI)

1. Results in input order; peak in-flight ≤ effective limit; sliding pool
   (finished task replaced immediately — never batches).
2. Legacy call shape `parallel(jobs, 30)` and the default export are frozen —
   published dependents rely on them.
3. Limit normalization: non-positive/non-integer → 5; `Infinity` → unbounded.
4. Fail-fast stops scheduling; settle mode never rejects on job errors.
5. Abort (even synchronous, from inside a job) rejects with `signal.reason`;
   listener always removed; no unhandled rejections ever.
6. Zero runtime dependencies; compiles without DOM/es2020 libs; typings floor
   TS 3.4 (`readonly` array syntax — nothing newer in the public d.ts).
7. Node floor 16.14 (`engines`), tested exactly in CI.

## Conventions

- No new runtime dependencies. Keep declaration-emit clean (JSDoc flows into
  `dist/index.d.ts` — it is consumer documentation).
- Every bug fix lands with a regression test; behavioral claims in README must
  have a matching CI gate.
