type Unpacked<T> =
  T extends (...args: any[]) => infer U ? U :
  T extends Promise<infer U> ? U :
  T

type MapToResult<T> = { [K in keyof T]: Unpacked<Unpacked<T[K]>> }

/** Per-item outcome for the settle-all variants. Mirrors `PromiseSettledResult`
 *  but is defined locally so the package needs no `es2020`/DOM lib. */
export type SettledResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: any }

type MapToSettled<T> = { [K in keyof T]: SettledResult<Unpacked<Unpacked<T[K]>>> }

/** Minimal structural shape of an `AbortSignal`. Declared locally so consumers
 *  don't need the DOM lib; a real `AbortController().signal` satisfies it. */
export interface AbortSignalLike {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

export interface ParallelOptions {
  /**
   * Cancel the run early. When the signal aborts, the returned promise rejects
   * with the signal's `reason` and no further jobs are started. Jobs already in
   * flight are not (and cannot be) force-cancelled — they run to completion but
   * their results are discarded.
   */
  signal?: AbortSignalLike
}

export const DEFAULT_CONCURRENCY = 5

type Job<T> = () => Promise<T>

const normalizeLimit = (limit: number | undefined): number =>
  typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CONCURRENCY

const abortReason = (signal: AbortSignalLike): unknown => {
  if (signal.reason !== undefined) return signal.reason
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

/**
 * Shared worker-pool core for all four public variants. Spawns up to
 * `concurrency` long-lived workers that pull from a shared cursor, so a worker
 * that finishes a job immediately picks up the next unclaimed one (sustained
 * concurrency, not batching). Results are written back at each job's index, so
 * ordering matches the input regardless of completion order.
 */
const run = async (
  jobs: Array<Job<any>>,
  limit: number | undefined,
  settle: boolean,
  signal: AbortSignalLike | undefined,
): Promise<any[]> => {
  if (!Array.isArray(jobs)) {
    throw new Error('First argument is not an array.')
  }
  if (signal && signal.aborted) {
    throw abortReason(signal)
  }

  const concurrency = normalizeLimit(limit)
  const results: any[] = new Array(jobs.length)
  let index = 0
  // Set on the first rejection in fail-fast mode so the surviving workers stop
  // pulling new jobs — the caller has already been handed the rejection.
  let stopped = false

  const worker = async (): Promise<void> => {
    while (true) {
      // Stop pulling new work once aborted or failed; jobs already in flight
      // run to completion but their results are discarded by the caller.
      if (stopped || (signal && signal.aborted)) return
      const i = index++
      if (i >= jobs.length) return
      if (settle) {
        try {
          results[i] = { status: 'fulfilled', value: await jobs[i]() }
        } catch (reason) {
          results[i] = { status: 'rejected', reason }
        }
      } else {
        try {
          results[i] = await jobs[i]()
        } catch (err) {
          stopped = true
          throw err
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, jobs.length)
  const workers: Promise<void>[] = []
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker())
  }

  const all = Promise.all(workers)

  if (!signal) {
    await all
    return results
  }

  // Reject promptly when the signal fires, without waiting for in-flight jobs.
  let onAbort!: () => void
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  // Swallow a late rejection from a straggler that settles after we've aborted,
  // so it doesn't surface as an unhandled rejection. `all` still propagates a
  // job failure to the race below when no abort occurred.
  all.catch(() => {})

  try {
    await Promise.race([all, aborted])
    return results
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Run an array of async, zero-argument job functions with a bounded number of
 * jobs in flight at any one time.
 *
 * Results are returned in the same order as `jobs` (not completion order). When
 * `jobs` is a `readonly` tuple (e.g. declared `as const`), the result type is an
 * ordered tuple matching each job's resolved value.
 *
 * If any job rejects, the returned promise rejects with the first such error
 * (matching `Promise.all` semantics); no further jobs are started, and jobs
 * already in flight run to completion but their results are discarded. Use
 * {@link settle} to collect every outcome instead of failing fast.
 *
 * @param jobs    Array of functions, each returning a promise.
 * @param limit   Max jobs to run concurrently. Values that are not positive
 *                integers fall back to {@link DEFAULT_CONCURRENCY} (5).
 * @param options Optional `{ signal }` to cancel the run early.
 */
const parallel = <T>(
  jobs: { [K in keyof T]: () => Promise<T[K]> },
  limit?: number,
  options?: ParallelOptions,
): Promise<MapToResult<typeof jobs>> =>
  run(jobs as Array<Job<any>>, limit, false, options && options.signal) as Promise<MapToResult<typeof jobs>>

/**
 * Like {@link parallel}, but never rejects because of a failing job. Resolves to
 * an array of per-job outcomes (`{ status: 'fulfilled', value }` or
 * `{ status: 'rejected', reason }`) in input order — the concurrency-limited
 * equivalent of `Promise.allSettled`.
 */
const settle = <T>(
  jobs: { [K in keyof T]: () => Promise<T[K]> },
  limit?: number,
  options?: ParallelOptions,
): Promise<MapToSettled<typeof jobs>> =>
  run(jobs as Array<Job<any>>, limit, true, options && options.signal) as Promise<MapToSettled<typeof jobs>>

/**
 * Map over `items` with a concurrency limit, calling `mapper(item, index)` for
 * each and resolving to the results in input order. The convenience form of
 * {@link parallel} when you have data plus a transform rather than pre-built
 * thunks. Fails fast on the first rejection.
 *
 * @param items   Array of inputs.
 * @param mapper  `(item, index) => value | Promise<value>`.
 * @param limit   Max concurrent calls (default {@link DEFAULT_CONCURRENCY}).
 * @param options Optional `{ signal }` to cancel the run early.
 */
const map = async <I, R>(
  items: readonly I[],
  mapper: (item: I, index: number) => R | Promise<R>,
  limit?: number,
  options?: ParallelOptions,
): Promise<R[]> => {
  if (!Array.isArray(items)) {
    throw new Error('First argument is not an array.')
  }
  const jobs = items.map((item, i) => async () => mapper(item, i))
  return run(jobs, limit, false, options && options.signal) as Promise<R[]>
}

/**
 * Like {@link map}, but never rejects because of a failing mapper call. Resolves
 * to an array of per-item outcomes in input order — the concurrency-limited
 * equivalent of `Promise.allSettled` over a mapped array.
 */
const mapSettled = async <I, R>(
  items: readonly I[],
  mapper: (item: I, index: number) => R | Promise<R>,
  limit?: number,
  options?: ParallelOptions,
): Promise<SettledResult<R>[]> => {
  if (!Array.isArray(items)) {
    throw new Error('First argument is not an array.')
  }
  const jobs = items.map((item, i) => async () => mapper(item, i))
  return run(jobs, limit, true, options && options.signal) as Promise<SettledResult<R>[]>
}

export default parallel
export { parallel, settle, map, mapSettled }
