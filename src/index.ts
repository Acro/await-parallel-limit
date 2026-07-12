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
 *  don't need the DOM lib; a real `AbortController().signal` satisfies it.
 *  `reason` is `any` (not `unknown`) so this interface adds no TypeScript-version
 *  constraint of its own; the package's effective typings floor is TS 3.4, set by
 *  the `readonly` array syntax in the `map`/`mapSettled` signatures. */
export interface AbortSignalLike {
  readonly aborted: boolean
  readonly reason?: any
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

// `Infinity` means "no limit" (run everything at once) — 2.x behaviour.
const normalizeLimit = (limit: number | undefined): number =>
  limit === Infinity ? Infinity :
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
 * that finishes an item immediately picks up the next unclaimed one (sustained
 * concurrency, not batching). Results are written back at each item's index, so
 * ordering matches the input regardless of completion order.
 *
 * Workers call `invoke(items[i], i)` directly instead of materialising a thunk
 * per element: `parallel`/`settle` pass the jobs array with a call-the-thunk
 * invoker, `map`/`mapSettled` pass the user's items with the mapper itself.
 * This avoids a closure + an extra promise per item on large inputs.
 */
const run = async (
  items: readonly any[],
  invoke: (item: any, index: number) => any,
  limit: number | undefined,
  settle: boolean,
  signal: AbortSignalLike | undefined,
): Promise<any[]> => {
  if (!Array.isArray(items)) {
    throw new Error('First argument is not an array.')
  }
  if (signal && signal.aborted) {
    throw abortReason(signal)
  }

  const concurrency = normalizeLimit(limit)
  // Snapshot the length so mutating `items` mid-run cannot silently shrink or
  // grow the result set; elements themselves are still read lazily at dispatch.
  const total = items.length
  const results: any[] = new Array(total)
  let index = 0
  // Single stop mechanism: set on the first fail-fast rejection and by the
  // abort listener, so once the returned promise settles early, workers stop
  // pulling new items. Items already in flight run to completion but their
  // results are discarded by the caller.
  let stopped = false

  const worker = async (): Promise<void> => {
    while (true) {
      if (stopped) return
      const i = index++
      if (i >= total) return
      if (settle) {
        try {
          results[i] = { status: 'fulfilled', value: await invoke(items[i], i) }
        } catch (reason) {
          results[i] = { status: 'rejected', reason }
        }
      } else {
        try {
          results[i] = await invoke(items[i], i)
        } catch (err) {
          stopped = true
          throw err
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, total)
  const workers: Promise<void>[] = []
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker())
  }
  const all = Promise.all(workers)

  if (!signal) {
    await all
    return results
  }

  let onAbort: (() => void) | undefined
  try {
    return await new Promise<any[]>((resolve, reject) => {
      onAbort = () => {
        stopped = true
        reject(abortReason(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      // A job can abort the signal synchronously while the workers are still
      // starting up — before the listener above exists. Real signals do not
      // fire 'abort' for listeners added after the fact, so re-check by hand.
      if (signal.aborted) onAbort()
      // `reject` here also absorbs a straggler's rejection arriving after an
      // abort has settled this promise, so it never becomes unhandled.
      all.then(() => resolve(results), reject)
    })
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

const callThunk = (job: () => Promise<any>) => job()

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
 * @param limit   Max jobs to run concurrently (`Infinity` = unbounded). Values
 *                that are not positive integers fall back to
 *                {@link DEFAULT_CONCURRENCY} (5).
 * @param options Optional `{ signal }` to cancel the run early.
 * @example
 * const jobs = [async () => 1, async () => 'a'] as const
 * const [n, s] = await parallel(jobs, 2) // n: number, s: string
 */
const parallel = <T>(
  jobs: { [K in keyof T]: () => Promise<T[K]> },
  limit?: number,
  options?: ParallelOptions,
): Promise<MapToResult<typeof jobs>> =>
  run(jobs as readonly any[], callThunk, limit, false, options && options.signal) as Promise<MapToResult<typeof jobs>>

/**
 * Like {@link parallel}, but never rejects because of a failing job. Resolves to
 * an array of per-job outcomes (`{ status: 'fulfilled', value }` or
 * `{ status: 'rejected', reason }`) in input order — the concurrency-limited
 * equivalent of `Promise.allSettled`.
 *
 * @example
 * const outcomes = await settle(jobs, 5)
 * const failed = outcomes.filter((o) => o.status === 'rejected')
 */
const settle = <T>(
  jobs: { [K in keyof T]: () => Promise<T[K]> },
  limit?: number,
  options?: ParallelOptions,
): Promise<MapToSettled<typeof jobs>> =>
  run(jobs as readonly any[], callThunk, limit, true, options && options.signal) as Promise<MapToSettled<typeof jobs>>

/**
 * Map over `items` with a concurrency limit, calling `mapper(item, index)` for
 * each and resolving to the results in input order. The convenience form of
 * {@link parallel} when you have data plus a transform rather than pre-built
 * thunks. Fails fast on the first rejection. Sparse-array holes are passed to
 * the mapper as `undefined` (matching `Promise.all`).
 *
 * @param items   Array of inputs.
 * @param mapper  `(item, index) => value | Promise<value>`.
 * @param limit   Max concurrent calls (default {@link DEFAULT_CONCURRENCY}).
 * @param options Optional `{ signal }` to cancel the run early.
 * @example
 * const bodies = await map(urls, (url) => fetch(url).then((r) => r.text()), 10)
 */
const map = <I, R>(
  items: readonly I[],
  mapper: (item: I, index: number) => R | Promise<R>,
  limit?: number,
  options?: ParallelOptions,
): Promise<R[]> =>
  run(items, mapper, limit, false, options && options.signal) as Promise<R[]>

/**
 * Like {@link map}, but never rejects because of a failing mapper call. Resolves
 * to an array of per-item outcomes in input order — the concurrency-limited
 * equivalent of `Promise.allSettled` over a mapped array.
 *
 * @example
 * const outcomes = await mapSettled(urls, (url) => fetch(url), 10)
 * const failedUrls = urls.filter((_, i) => outcomes[i].status === 'rejected')
 */
const mapSettled = <I, R>(
  items: readonly I[],
  mapper: (item: I, index: number) => R | Promise<R>,
  limit?: number,
  options?: ParallelOptions,
): Promise<SettledResult<R>[]> =>
  run(items, mapper, limit, true, options && options.signal) as Promise<SettledResult<R>[]>

export default parallel
export { parallel, settle, map, mapSettled }
