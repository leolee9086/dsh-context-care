import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionLog } from './session-log.js';
interface History {
    readSession(id: Session['id']): Promise<{
        inheritedEventCount: number;
        length: number;
        select(types: readonly SessionEvent['type'][], fromSeq?: number): readonly SessionEvent[];
        [Symbol.dispose]?(): void;
    }>;
}
/**
 * Attach actual proposal identity and an optional actual failure to compaction events.
 * This describes an executed compaction; it is never an independent state snapshot.
 * @param proposalKey - fingerprint of selected material, prices and summary policy.
 * @param failureCode - the summary execution's terminal code, when present.
 * @returns metadata for the real compaction/start or compaction/end append.
 */
export declare function summaryProposalRecord(proposalKey: unknown, failureCode?: unknown): {
    contextCareSummary?: undefined;
} | {
    contextCareSummary: {
        failureCode?: string | undefined;
        format: string;
        proposalKey: string;
    };
};
/**
 * Reconstruct rejected proposals solely from paired native compaction executions.
 * @param history - the existing native Session query, without Agent activation.
 * @returns incremental live observation and cancellable reads with disposable caches.
 */
export declare function createSummaryProposalHistory(history: History, logs: Pick<SessionLog, 'cache'>): {
    /** Follow actual commits; cold and mid-install Sessions restore on first read. */
    observe(session: Session, event: SessionEvent): void;
    /** Read one exact proposal rejection; status-only log growth cannot clear it. */
    has(session: Session, key: string, signal?: AbortSignal): Promise<boolean>;
    /** Forget derived proposal state; the next owner reconstructs from the same log. */
    close(): void;
};
export {};
