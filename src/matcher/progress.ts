/**
 * Worker-owned progress, readable even while the Host event loop cannot receive messages.
 * A delayed timer must never terminate a rule that has already finished. Monotonic
 * hrtime is shared across Node threads; no wall clock or message arrival time is used.
 */
export interface ProgressSnapshot {
  phase: 'waiting' | 'running' | 'between' | 'finished'
  index: number
  startedNs: bigint
  limitNs: bigint
  spentNs: bigint
  roundLimited: boolean
}
const slots = 8
const phases = ['waiting', 'running', 'between', 'finished'] as const
export const milliseconds = (ns: bigint): number => Number(ns) / 1e6
export const nanoseconds = (ms: number): bigint => BigInt(Math.max(0, Math.round(ms * 1e6)))

export function createProgress(): SharedArrayBuffer { return new SharedArrayBuffer(slots * BigInt64Array.BYTES_PER_ELEMENT) }

export function readProgress(buffer: SharedArrayBuffer): ProgressSnapshot | undefined {
  const data = new BigInt64Array(buffer)
  // The worker may be between the writes below. Never spin on a worker which is
  // being terminated: the supervisor can read again at its next bounded tick.
  for (let attempt = 0; attempt < 3; attempt++) {
    const revision = Atomics.load(data, 0)
    if (revision % 2n !== 0n) continue
    const phase = phases[Number(Atomics.load(data, 1))]
    const index = Number(Atomics.load(data, 2))
    const startedNs = Atomics.load(data, 3), limitNs = Atomics.load(data, 4)
    const spentNs = Atomics.load(data, 5), roundLimited = Atomics.load(data, 6) === 1n
    if (phase && revision === Atomics.load(data, 0)) return { phase, index, startedNs, limitNs, spentNs, roundLimited }
  }
  return undefined
}

export function progressWriter(buffer: SharedArrayBuffer) {
  const data = new BigInt64Array(buffer)
  let spentNs = 0n, startedNs = 0n
  const write = (phase: number, index: number, limitNs = 0n, roundLimited = false) => {
    Atomics.add(data, 0, 1n)
    Atomics.store(data, 1, BigInt(phase))
    Atomics.store(data, 2, BigInt(index))
    Atomics.store(data, 3, startedNs)
    Atomics.store(data, 4, limitNs)
    Atomics.store(data, 5, spentNs)
    Atomics.store(data, 6, roundLimited ? 1n : 0n)
    Atomics.add(data, 0, 1n)
  }
  return {
    start(index: number, limitMs: number, roundLimited = false) {
      startedNs = process.hrtime.bigint()
      write(1, index, nanoseconds(limitMs), roundLimited)
    },
    finish(index: number): number {
      const elapsedNs = process.hrtime.bigint() - startedNs
      spentNs += elapsedNs
      write(2, index)
      return milliseconds(elapsedNs)
    },
    done() { write(3, -1) },
    get elapsedMs() { return milliseconds(spentNs) },
  }
}

export interface ExecutionCheckpoint {
  start(index: number, limitMs: number, roundLimited?: boolean): void
  finish(index: number): number
}
