import parallel from '../dist/index'

var count = 0

const do_something = async () => {
    const timeout = Math.random()*100 + 100
    console.log(count++, timeout)
    return await new Promise(resolve => setTimeout(resolve, timeout))
}

const another_async = async () => {
    return await (async () => {
        return [true, true]
    })()
}

const jobs = [
    do_something,
    async () => {
        return await another_async()
    },
    async () => {
        return await 2
    },
    do_something,
] as const

const run = (async () => {
    const result = await parallel(jobs, 1)
    console.log(result)
})

run()