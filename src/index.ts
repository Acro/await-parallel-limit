type Unpacked<T> =
    T extends (infer U)[] ? U :
    T extends (...args: any[]) => infer U ? U :
    T extends Promise<infer U> ? U :
    T;

const parallel = async <T>(
  jobs: { [K in keyof T]: (() => Promise<Unpacked<T[K]>>) },
  limit:number,
) => {
  type Data = typeof jobs
  type MapToResult<X extends Data> = { [K in keyof X]: Unpacked<Unpacked<X[K]>> }

  if (!Array.isArray(jobs)) {
    throw new Error('First argument is not an array.') 
  }

  var n = Math.min(limit || 5, jobs.length)
  var ret:any = []
  var index = 0

  var next = async () => {
    var i = index++
    var job = jobs[i]
    ret[i] = await job()
    if (index < jobs.length) await next()
  }

  var next_arr = Array(n).fill(next)
  await Promise.all(next_arr.map((f) => { return f() }))

  return <MapToResult<Data>>ret
}

export default parallel