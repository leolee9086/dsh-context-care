import type { Session, SessionSeq, EpochHeader } from '@deepseek-ai/dsh-session';
import type { TokenUsage, LlmCallConfig } from '@deepseek-ai/dsh-llm';
import { requestDecision } from './request-replay.js';
import type { SessionLog } from './session-log.js';
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
export declare function createRequestHistory(logs: SessionLog): {
    headerKey: (header: EpochHeader | undefined) => string;
    /** Read settled requests, consuming only events appended since the last read. */
    read(session: Session): readonly SessionRequestRecord[];
    /** One native settlement lookup, without searching the full request array per diagnostic. */
    contains(session: Session, row: {
        key: string;
        data: Readonly<Record<string, unknown>>;
    }): boolean;
    previous(session: Session, purpose: string): SessionRequestRecord | undefined;
    /** Do not serialize every historical catalog merely to list requests. Each actual
     * configuration has one pending newest-first lane and a positive header index.
     * Unknown configurations allocate nothing; repeated negative queries do no fold work. */
    calibration(session: Session, header: EpochHeader | undefined): SessionRequestRecord | undefined;
};
