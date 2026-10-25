import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session';
import { type HandoffRule, type StateValue, type StickyStateValue } from './state.js';
export interface DeliveryState {
    windows: StateValue['windows'];
    stickies: StickyStateValue[];
    ticked: Set<string>;
    committedIds: ReadonlySet<string>;
    humanId: string;
    /** Accepted unreserved input remains retryable after claim until commit or cancellation. */
    queued: readonly UserMessage[];
}
/**
 * Disposable delivery projection. Cold reads use the native query service; live
 * commits advance the same fold. No rule, judge or template runs while restoring.
 */
export declare function createSessionDeliveries(ctx: Context, now?: () => number): {
    /** Newly created sessions can maintain this projection without a history read. */
    created(session: Session): void;
    /** Read accepted inputs, including quota-blocked claims no longer in the inbox. */
    queued(sessionId: string): UserMessage[];
    observe(session: Session, event: SessionEvent): void;
    /** Cache-only read for the final synchronous cancel/steer check. */
    currentHumanTurn(sessionId: string): string | undefined;
    /** Native handoff evidence survives cancellation, compaction and an empty runtime cache. */
    wasHanded(sessionId: string, eventId: string, rule?: HandoffRule, fromSeq?: number): Promise<boolean>;
    /** Last local human arrival; a delayed commit does not create a new interrupt budget. */
    humanTurn(sessionId: string): Promise<string>;
    read(sessionId: string, currentHumanId: string, fromSeq?: number): Promise<DeliveryState>;
    close(): void;
};
