import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
interface Route {
    provider: string;
    model: string;
}
interface Candidate {
    label: string;
    line: string;
}
export interface CompletionRequest extends Route {
    purpose?: string;
}
/** An observation of wording, not a declaration that the underlying task is complete. */
export interface CompletionNotice extends Candidate {
    sessionId: string;
    eventSeq: number;
    route: Route;
    deliveries: number;
    maxDeliveries: number;
    status: 'pending' | 'delivery-unknown' | 'dispatched' | 'superseded';
    callId?: string;
}
/** Exact prompt input; the request Host commits this segment with its real header. */
export interface CompletionSegment extends Route {
    ruleId: 'completion-observation';
    version: '1';
    trigger: 'completion';
    purpose: 'conversation';
    sourceSeqs: number[];
    completionKey: string;
    text: string;
}
interface Options {
    sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush'>;
    cooldownMs: number;
    maxObservedChars: number;
    maxDeliveries: number;
    active: (session: Session) => boolean;
    since: (session: Session) => number;
    parse: (text: string) => Candidate | undefined;
}
/**
 * Derive completion wording, cooldown and delivery from native Session facts.
 * Reservations only serialize live request preparation; no domain file is read or written.
 * @param options - native sessions, rule settings and bounded wording parser.
 * @returns the completion request contribution and disposable projection owner.
 */
export declare function createSessionCompletions(options: Options): {
    /** Native persistence owns all durable work; this does not ACK a second store. */
    flush(sessionId?: string): Promise<void>;
    reconcile(session: Session): Promise<void>;
    collect(session: Session, request: CompletionRequest): CompletionSegment[];
    reserve(session: Session, segments: readonly {
        completionKey?: string;
    }[], callId: string): Promise<void>;
    rollback(_session: Session, callId: string): Promise<void>;
    dispatched(session: Session, _segments: readonly {
        completionKey?: string;
    }[], callId: string, _request: CompletionRequest): Promise<void>;
    list(sessionId?: string): CompletionNotice[];
    /** Release derived state; the next request reconstructs it from the same events. */
    clear(): void;
    close(): void;
};
export {};
