import type { Context } from '@deepseek-ai/cordis';
import type { Session, EpochHeader } from '@deepseek-ai/dsh-session';
import type { LlmCallConfig, GenerateOptions } from '@deepseek-ai/dsh-llm';
import { type SessionRequestRecord } from './request-history.js';
import type { SessionLog } from './session-log.js';
type Data = Readonly<Record<string, unknown>>;
export interface CacheRecord {
    key: string;
    version: 1;
    sessionId: string;
    kind: 'request' | 'maintenance';
    /** Live diagnostics are not independent durable audit records. */
    transient?: true;
    at: number;
    data: Data;
}
interface Options {
    logs: SessionLog;
    sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush' | 'prepare'>;
    measureInput: (session: Session, request: GenerateOptions) => {
        textTokens: number;
        visualTokens: number;
    };
    /** Current estimator/provider capability identities used by measureInput. */
    measurementDependencies?: (header: EpochHeader | undefined) => readonly unknown[];
    now?: () => number;
    /** Publish the admitted record, so observers invalidate its own view only. */
    changed?: (sessionId: string, record: CacheRecord) => void;
}
/**
 * Keep in-flight diagnostics in memory and read settled request facts from Session.
 * This cache owns no storage domain; clearing it cannot erase a committed request.
 * @param options - the live Session service and optional observation clock.
 * @returns the request query facade and its process-local recorder.
 */
export declare function createRequestCache({ sessions, logs, measureInput, measurementDependencies, now, changed }: Options): {
    /** Record only an operation currently owned by this process; never write a JSON side record. */
    put(key: string, sessionId: string, kind: CacheRecord["kind"], input: Record<string, unknown>): Promise<void>;
    /** The durability checkpoint belongs to Session, not to a second writer. */
    flush(sessionId?: string): Promise<void>;
    /** Production pages consume exact coalesced changes, not a full sorted snapshot. */
    diagnosticFeed(sessionId: string): {
        set(id: string, record: CacheRecord): void;
        delete(id: string): void;
        snapshot(): readonly CacheRecord[];
        consume(cursor: object): import("./diagnostic-pages.js").DiagnosticRecordDelta<CacheRecord>;
    };
    /** A stable read-only cut for diagnostic projections; list() still returns its own array. */
    view(sessionId: string): readonly CacheRecord[];
    /** Read actual settlements plus bounded live diagnostics for loaded sessions. */
    list(sessionId?: string): CacheRecord[];
    /** Read a previous dispatched route without trusting a persisted context-care table. */
    previousRoute(session: Session, purpose: string): LlmCallConfig | undefined;
    settled: (session: Session) => readonly SessionRequestRecord[];
    /** Reprice a logged input only once per settlement; no cached row is required after restart. */
    calibrationRecords(session: Session, header: EpochHeader | undefined): CacheRecord[];
    /** Idle/unloaded Agents retain no unfinished request objects. */
    release(session: Session): void;
    /** Forgetting transient diagnostics does not modify Session or storage. */
    close(): Promise<void>;
};
export {};
