import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import { type EventValue, type NativeRecoverySelection } from './state.js';
import type { OutputConfig } from './output-stream.js';
interface Submission {
    event: EventValue;
}
export interface NativeHistory {
    sessions: Pick<Context['sessions'], 'get' | 'prepare' | 'messageProjections'>;
    readSession: (id: Session['id']) => Promise<{
        events: readonly SessionEvent[];
        inheritedEventCount?: number;
        at?(seq: number): SessionEvent | undefined;
        range?(fromSeq: number): Iterable<SessionEvent>;
        [Symbol.dispose]?(): void;
    }>;
}
interface Config {
    maxContextChars: number;
    maxContextMessages: number;
    maxQueued: number;
    maxConcurrent: number;
    output?: OutputConfig;
}
/**
 * Derive tool reminders from actual committed call/result events. Both maps are
 * disposable; neither records a judge outcome or acknowledges a reminder.
 * @param config - matcher context bounds and live admission capacity.
 * @param history - native reads and detached preparation used after cache loss.
 * @returns the live event fold, canonical trigger resolution and lifecycle release.
 */
export declare function createToolEvents(config: Config, history?: NativeHistory): {
    /** Newly created Sessions have no missed tool history; raw events still depend on rule interest. */
    created(session: Session): void;
    /** Cache the actual native event separately from a tool outcome at the same seq. */
    observeSession(session: Session, event: SessionEvent): EventValue;
    /** Only an actual logged call can supply a native anchor for the execution hook. */
    preparation(session: Session, callId: string): {
        type: "tool-call";
        seq: number;
    } | undefined;
    /** A paired native call publishes its result after the execution hook. */
    waitForCommit(session: Session, callId: string): boolean;
    /** Fold the synchronous post-commit feed; old events must use resolve instead. */
    observe(session: Session, event: SessionEvent): Submission | undefined;
    /**
     * Resolve an anchored submission from its native log, including the model
     * surface immediately before that result. The detached prefix never enters
     * the live store or activates an Agent. Supplied copies of call facts do not win.
     */
    resolve(event: EventValue, signal?: AbortSignal): Promise<EventValue>;
    /** Discover selected local native facts in their original order from one log read. */
    recover(sessionId: string, accept: (event: EventValue) => Promise<void>, signal: AbortSignal, selection?: NativeRecoverySelection): Promise<void>;
    /** Release process-local pairing and context caches without changing any log. */
    close(): void;
};
export {};
