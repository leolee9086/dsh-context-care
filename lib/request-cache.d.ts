import type { Context } from '@deepseek-ai/cordis';
import type { Session, EpochHeader } from '@deepseek-ai/dsh-session';
import type { LlmCallConfig, GenerateOptions } from '@deepseek-ai/dsh-llm';
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
    sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush' | 'prepare'>;
    measureInput: (session: Session, request: GenerateOptions) => {
        textTokens: number;
        visualTokens: number;
    };
    now?: () => number;
    changed?: (sessionId: string) => void;
}
/**
 * Keep in-flight diagnostics in memory and read settled request facts from Session.
 * This cache owns no storage domain; clearing it cannot erase a committed request.
 * @param options - the live Session service and optional observation clock.
 * @returns the request query facade and its process-local recorder.
 */
export declare function createRequestCache({ sessions, measureInput, now, changed }: Options): {
    /** Record only an operation currently owned by this process; never write a JSON side record. */
    put(key: string, sessionId: string, kind: CacheRecord["kind"], input: Record<string, unknown>): Promise<void>;
    /** The durability checkpoint belongs to Session, not to a second writer. */
    flush(sessionId?: string): Promise<void>;
    /** Read actual settlements plus bounded live diagnostics for loaded sessions. */
    list(sessionId?: string): CacheRecord[];
    /** Read a previous dispatched route without trusting a persisted context-care table. */
    previousRoute(session: Session, purpose: string): LlmCallConfig | undefined;
    settled: (session: Session) => readonly import("./request-history.js").SessionRequestRecord[];
    /** Reprice a logged input only once per settlement; no cached row is required after restart. */
    calibrationRecords(session: Session, header: EpochHeader | undefined): CacheRecord[];
    /** Idle/unloaded Agents retain no unfinished request objects. */
    release(session: Session): void;
    /** Forgetting the cache does not modify any Session or existing storage files. */
    close(): Promise<void>;
};
export {};
