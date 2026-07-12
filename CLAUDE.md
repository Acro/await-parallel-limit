# await-parallel-limit

Follow `AGENTS.md` — it has the build/test/fuzz commands, architecture map,
and the invariants this package must never break. Consumer-facing API
reference lives in `llms.txt`.

Quick anchors:
- `npm test` = build + exact-type gate + unit suite (strict unhandled rejections)
- `npm run fuzz -- 300` before any change to `src/index.ts`
- Package-boundary verification recipe: `.claude/skills/verify/SKILL.md`
- Never break: input-order results, sliding-pool concurrency, the v2 call shape
  `parallel(jobs, limit)`, zero dependencies, TS 3.4 typings floor.
