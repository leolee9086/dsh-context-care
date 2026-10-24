import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import type { OutputConfig, OutputEvent } from './output-stream.js';
interface Identity {
    sessionId: string;
    attemptId: string;
    turn: number;
    step: number;
}
/**
 * Fold readable chunks using their native timestamps. Timers publish at the
 * recorded deadline even if the Host callback runs late; the next chunk first
 * flushes any earlier deadline. The same fold therefore works without timers.
 * @param config - readable text, block and flush limits.
 * @param identity - stable identity and native step owning this attempt.
 * @param report - reports the first block-capacity failure.
 * @returns incremental chunk, deadline and terminal readers.
 */
export declare function createOutputProjection(config: OutputConfig, identity: Identity, report: (error: unknown) => void): {
    push: (at: number, chunk: StreamChunk) => Generator<OutputEvent>;
    advance: (at: number) => Generator<OutputEvent>;
    finish: (at: number) => Generator<OutputEvent>;
    readonly deadline: number | undefined;
    stop(): void;
};
export {};
