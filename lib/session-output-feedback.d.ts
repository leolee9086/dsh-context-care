import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionLog } from './session-log.js';
export interface Route {
    provider: string;
    model: string;
}
export interface DetectorBounds {
    windowOutputs: number;
    cooldownCompletedOutputs: number;
    rearmHealthyOutputs: number;
    maxDeliveries: number;
}
export interface FeedbackRule<D> extends Route {
    ruleId: string;
    version: string;
    trigger: string;
    text: string;
    detector?: D;
    carryFromOtherRoute?: boolean;
}
export interface FeedbackMetrics {
    status: string;
    H?: number;
    K?: number;
    N?: number;
    evidence?: readonly {
        text: string;
    }[];
}
type Sample<M> = M & {
    seq: number;
};
type Measured<M> = Sample<M> & {
    H: number;
    K: number;
    N: number;
    evidence: readonly {
        text: string;
    }[];
};
interface Pending<M> {
    segmentId: string;
    sourceSeqs: number[];
    sample: Measured<M>;
    trigger: string;
    deliveries: number;
    maxDeliveries: number;
}
interface Delivery {
    segmentId: string;
    callId: string;
    status: string;
    attempts?: number;
    exhausted?: boolean;
}
export interface Episode<M> {
    version: 1;
    sessionId: string;
    ruleId: string;
    ruleVersion: string;
    specHash: string;
    route: Route;
    lastSeq: number;
    completed: number;
    cooldownUntil: number;
    healthy: number;
    window: Sample<M>[];
    pending?: Pending<M>;
    lastDelivery?: Delivery;
}
export interface Segment<M> extends Route {
    ruleId: string;
    version: string;
    trigger: 'output-pattern';
    purpose: 'conversation';
    text: string;
    segmentId: string;
    sourceRoute: Route;
    sourceSeqs: number[];
    metrics: Sample<M>;
    feedbackKey: string;
}
interface Options<D, M> {
    sessions: Pick<Context['sessions'], 'get' | 'list' | 'flush'>;
    logs: SessionLog;
    detect(text: string, config: D): M;
    trigger(sample: Sample<M>, window: readonly Sample<M>[], config: D): string | undefined;
    rulesFor(sessionId: string): readonly FeedbackRule<D>[];
    eligible(sessionId: string, ruleId: string, seqs: number[]): boolean;
    revision(sessionId: string): number;
}
/**
 * Derive output-pattern episodes from successful native output and actual request inputs.
 * The only live-only state coordinates preparation; no feedback domain is opened.
 * @param options - existing Session service, rule definitions and deterministic parser.
 * @returns the request contribution and disposable native projection owner.
 */
export declare function createSessionOutputFeedback<D extends DetectorBounds, M extends FeedbackMetrics>(options: Options<D, M>): {
    /** Canonical output already exists in Session; callback copies cannot change it. */
    observe(session: Session, _event: SessionEvent, _route: unknown, rules: readonly FeedbackRule<D>[]): Promise<void>;
    collect(session: Session, request: Route & {
        purpose?: string;
    }, rules: readonly FeedbackRule<D>[]): Segment<M>[];
    reserve(session: Session, segments: readonly {
        feedbackKey?: string;
    }[], callId: string): Promise<void>;
    rollback(_session: Session, callId: string): Promise<void>;
    dispatched(session: Session, _segments: readonly {
        feedbackKey?: string;
    }[], callId: string, _request?: Route): Promise<void>;
    flush(sessionId?: string): Promise<void>;
    list(sessionId?: string): Episode<M>[];
    clear(): void;
    close(): Promise<void>;
};
export {};
