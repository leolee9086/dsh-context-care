import type { Session, SessionSeq, EpochHeader } from '@deepseek-ai/dsh-session';
import type { TokenUsage, LlmCallConfig } from '@deepseek-ai/dsh-llm';
import { requestDecision } from './request-replay.js';
/** Request settlement facts read from the Session, not a second durable ledger. */
export interface SessionRequestRecord {
    key: string;
    version: 1;
    sessionId: string;
    kind: 'request';
    at: number;
    data: {
        callId: string;
        logRevision: number;
        dispatchOrder: number;
        purpose: 'conversation' | 'compaction';
        compactionId?: string;
        phase: 'settled';
        /** Absent when a failed attempt does not establish that the provider was entered. */
        dispatched?: boolean;
        outcome: 'completed' | 'interrupted' | 'failed';
        eventSeq: SessionSeq;
        eventType: 'assistant/message' | 'assistant/attempt' | 'compaction/summary';
        route?: LlmCallConfig;
        sourceHeader?: EpochHeader;
        usage?: TokenUsage;
        promptDecision?: NonNullable<NonNullable<ReturnType<typeof requestDecision>>['prompt']> & {
            seq: number;
        };
        workbenchDecision?: NonNullable<ReturnType<typeof requestDecision>>['workbench'];
    };
}
/**
 * Own a disposable incremental request index. Cached rows reference immutable log
 * values; no request body, tool schema, or header is serialized into another file.
 * @returns Session-scoped read and release operations.
 */
export declare function createRequestHistory(): {
    /** Read settled requests, consuming only events appended since the last read. */
    read(session: Session): readonly SessionRequestRecord[];
    /** Drop derived rows; the next read reconstructs them from the same Session. */
    clear(): void;
};
