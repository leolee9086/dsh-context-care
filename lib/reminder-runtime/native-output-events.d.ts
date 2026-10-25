import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { OutputConfig, OutputEvent } from './output-stream.js';
import type { SessionLogRead } from '../session-log.js';
type Terminal = Extract<SessionEvent, {
    type: 'assistant/message' | 'assistant/attempt';
}>;
/**
 * Name an attempt by its preceding native step/attempt, not an Agent-lifecycle counter.
 * @param session - Session whose next or committed stream is being observed.
 * @param log - shared native event index for this immutable cut.
 * @param before - exclusive event cursor; a terminal event excludes itself.
 * @returns the same key before streaming and after replaying its committed terminal.
 */
export declare function nativeOutputAttempt(session: Pick<Session, 'id'>, log: Pick<SessionLogRead, 'length' | 'last'>, before?: number): string;
/**
 * Reconstruct readable sample events from a committed native stream, including
 * interrupted messages and failed attempts. No live interruption is performed.
 * @param config - the same limits and flush intervals used by live observation.
 * @param session - native history containing the terminal and its preceding step.
 * @param terminal - actual completed, interrupted or failed assistant settlement.
 * @param report - reports bounded projection failures.
 * @returns ordered output samples with stable identities and recorded clocks.
 */
export declare function replayNativeOutput(config: OutputConfig, session: Pick<Session, 'id'>, log: Pick<SessionLogRead, 'length' | 'last'>, terminal: Terminal, report: (error: unknown) => void): Generator<OutputEvent>;
/** Distinguish chunk observations from final samples emitted after native settlement. */
export declare function nativeOutputSamples(config: OutputConfig, session: Pick<Session, 'id'>, log: Pick<SessionLogRead, 'length' | 'last'>, terminal: Terminal, report: (error: unknown) => void): Generator<{
    event: OutputEvent;
    afterCommit: boolean;
}>;
export {};
