/**
 * Worker-owned progress, readable even while the Host event loop cannot receive messages.
 * A delayed timer must never terminate a rule that has already finished. Monotonic
 * hrtime is shared across Node threads; no wall clock or message arrival time is used.
 */
export interface ProgressSnapshot {
    phase: 'waiting' | 'running' | 'between' | 'finished';
    index: number;
    startedNs: bigint;
    limitNs: bigint;
    spentNs: bigint;
    roundLimited: boolean;
}
export declare const milliseconds: (ns: bigint) => number;
export declare const nanoseconds: (ms: number) => bigint;
export declare function createProgress(): SharedArrayBuffer;
export declare function readProgress(buffer: SharedArrayBuffer): ProgressSnapshot | undefined;
export declare function progressWriter(buffer: SharedArrayBuffer): {
    start(index: number, limitMs: number, roundLimited?: boolean): void;
    finish(index: number): number;
    done(): void;
    readonly elapsedMs: number;
};
export interface ExecutionCheckpoint {
    start(index: number, limitMs: number, roundLimited?: boolean): void;
    finish(index: number): number;
}
