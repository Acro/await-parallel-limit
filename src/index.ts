type Unpacked<T> =
  T extends (...args: any[]) => infer U ? U :
  T extends Promise<infer U> ? U :
  T

type MapToResult<T> = { [K in keyof T]: Unpacked<Unpacked<T[K]>> }

export const DEFAULT_CONCURRENCY = 5

/**
 * Run an array of async, zero-argument job functions with a bounded number of
 * jobs in flight at any one time.
 *
 * Results are returned in the same order as `jobs` (not completion order). When
 * `jobs` is a `readonly` tuple (e.g. declared `as const`), the result type is an
 * ordered tuple matching each job's resolved value.
 *
 * If any job rejects, the returned promise rejects with the first such error
 * (matching `Promise.all` semantics); jobs already in flight still run to
 * completion but their results are discarded.
 *
 * @param jobs  Array of functions, each returning a promise.
 * @param limit Maximum number of jobs to run concurrently. Values that are not
 *              positive integers fall back to {@link DEFAULT_CONCURRENCY} (5).
 */
const parallel = async <T>(
  jobs: { [K in keyof T]: () => Promise<T[K]> },
  limit: number = DEFAULT_CONCURRENCY,
): Promise<MapToResult<typeof jobs>> => {
  if (!Array.isArray(jobs)) {
    throw new Error('First argument is not an array.')
  }

  // Normalise the concurrency limit. Non-integer / non-positive values fall back
  // to the default — this preserves the historical behaviour where a falsy limit
  // (e.g. `0` or `undefined`) meant "use the default of 5".
  const concurrency = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CONCURRENCY

  const results: any = new Array(jobs.length)
  let index = 0

  const worker = async (): Promise<void> => {
    while (true) {
      const i = index++
      if (i >= jobs.length) return
      results[i] = await jobs[i]()
    }
  }

  const workerCount = Math.min(concurrency, jobs.length)
  const workers: Promise<void>[] = []
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker())
  }
  await Promise.all(workers)

  return results as MapToResult<typeof jobs>
}

export default parallel
export { parallel }
