/**
 * Package-boundary TypeScript consumer. CI compiles this against the INSTALLED
 * package's d.ts with both the floor compiler (TypeScript 3.4) and the latest,
 * so a typings change that raises the floor or breaks inference fails the build.
 * Kept to TS 3.4-compatible syntax on purpose.
 */
import parallel, { settle, map, mapSettled, SettledResult } from 'await-parallel-limit'

const jobs = [
  async () => true,
  async () => 2,
] as const

async function main(): Promise<void> {
  const r = await parallel(jobs, 2)
  const a: boolean = r[0]
  const b: number = r[1]

  const s = await settle(jobs)
  if (s[0].status === 'fulfilled') {
    const x: boolean = s[0].value
  }

  const m: string[] = await map([1, 2], (n) => `${n}`, 2)
  const ms: SettledResult<number>[] = await mapSettled([1, 2], async (n) => n)

  void [a, b, m, ms]
}

void main
