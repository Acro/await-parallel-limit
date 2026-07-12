/**
 * Type-level regression tests. Compiled (never executed) by `npm test` via
 * `tsc --noEmit`; a wrong inference is a build failure. `Equal` distinguishes
 * exact types (not mere mutual assignability), so `any` creep fails too.
 */
import parallel, { settle, map, mapSettled, DEFAULT_CONCURRENCY, SettledResult, ParallelOptions } from '../src/index'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
declare function expectType<T extends true>(): void

async function cases(): Promise<void> {
  // Tuple inference from `as const` jobs — the library's signature feature.
  const jobs = [
    async () => true,
    async () => 2,
    async () => 'x',
  ] as const
  const tuple = await parallel(jobs, 2)
  expectType<Equal<typeof tuple, readonly [boolean, number, string]>>()

  // Legacy call shapes still typed.
  const noLimit = await parallel(jobs)
  expectType<Equal<typeof noLimit, readonly [boolean, number, string]>>()
  const withOptions = await parallel(jobs, 2, {} as ParallelOptions)
  expectType<Equal<typeof withOptions, readonly [boolean, number, string]>>()

  // Plain arrays widen to element unions, not any.
  const arr: Array<() => Promise<number>> = [async () => 1]
  const nums = await parallel(arr, 2)
  expectType<Equal<typeof nums, number[]>>()

  // settle: per-slot SettledResult with working discriminated-union narrowing.
  const settled = await settle(jobs, 2)
  expectType<Equal<typeof settled, readonly [SettledResult<boolean>, SettledResult<number>, SettledResult<string>]>>()
  const second = settled[1]
  if (second.status === 'fulfilled') {
    const value = second.value
    expectType<Equal<typeof value, number>>()
  } else {
    const reason = second.reason
    expectType<Equal<typeof reason, any>>()
  }

  // map: mapper drives the result type; sync and async mappers both unwrap.
  const mapped = await map([1, 2, 3], (n, i) => `${i}:${n}`, 2)
  expectType<Equal<typeof mapped, string[]>>()
  const mappedAsync = await map([1, 2, 3], async (n) => n * 2)
  expectType<Equal<typeof mappedAsync, number[]>>()

  // mapSettled.
  const ms = await mapSettled([1, 2], async (n) => n > 1)
  expectType<Equal<typeof ms, SettledResult<boolean>[]>>()

  expectType<Equal<typeof DEFAULT_CONCURRENCY, 5>>()
}

void cases
