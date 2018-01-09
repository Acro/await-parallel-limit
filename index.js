module.exports = async (jobs, limit) => {
  var n = Math.min(limit || 5, jobs.length)
  var ret = []
  var index = 0

  var next = async () => {
    var i = index++
    ret[i] = await jobs[i]()
    if (index < jobs.length) await next()
  }

  var next_arr = Array(n).fill(next)
  await Promise.all(next_arr.map((f) => { return f() }))

  return ret
}