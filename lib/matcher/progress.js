const slots = 8;
const phases = ['waiting', 'running', 'between', 'finished'];
export const milliseconds = (ns) => Number(ns) / 1e6;
export const nanoseconds = (ms) => BigInt(Math.max(0, Math.round(ms * 1e6)));
export function createProgress() { return new SharedArrayBuffer(slots * BigInt64Array.BYTES_PER_ELEMENT); }
export function readProgress(buffer) {
    const data = new BigInt64Array(buffer);
    // The worker may be between the writes below. Never spin on a worker which is
    // being terminated: the supervisor can read again at its next bounded tick.
    for (let attempt = 0; attempt < 3; attempt++) {
        const revision = Atomics.load(data, 0);
        if (revision % 2n !== 0n)
            continue;
        const phase = phases[Number(Atomics.load(data, 1))];
        const index = Number(Atomics.load(data, 2));
        const startedNs = Atomics.load(data, 3), limitNs = Atomics.load(data, 4);
        const spentNs = Atomics.load(data, 5), roundLimited = Atomics.load(data, 6) === 1n;
        if (phase && revision === Atomics.load(data, 0))
            return { phase, index, startedNs, limitNs, spentNs, roundLimited };
    }
    return undefined;
}
export function progressWriter(buffer) {
    const data = new BigInt64Array(buffer);
    let spentNs = 0n, startedNs = 0n;
    const write = (phase, index, limitNs = 0n, roundLimited = false) => {
        Atomics.add(data, 0, 1n);
        Atomics.store(data, 1, BigInt(phase));
        Atomics.store(data, 2, BigInt(index));
        Atomics.store(data, 3, startedNs);
        Atomics.store(data, 4, limitNs);
        Atomics.store(data, 5, spentNs);
        Atomics.store(data, 6, roundLimited ? 1n : 0n);
        Atomics.add(data, 0, 1n);
    };
    return {
        start(index, limitMs, roundLimited = false) {
            startedNs = process.hrtime.bigint();
            write(1, index, nanoseconds(limitMs), roundLimited);
        },
        finish(index) {
            const elapsedNs = process.hrtime.bigint() - startedNs;
            spentNs += elapsedNs;
            write(2, index);
            return milliseconds(elapsedNs);
        },
        done() { write(3, -1); },
        get elapsedMs() { return milliseconds(spentNs); },
    };
}
//# sourceMappingURL=progress.js.map