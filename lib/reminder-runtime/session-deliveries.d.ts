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
    /** Reuse the trigger discovery read; a live prefix may already be ahead of it. */
    observeLog(sessionId: string, log: {
        events: readonly SessionEvent[];
        inheritedEventCount?: number;
    }): void;
    /** Read uncommitted queued handoffs from an already observed native scan. */
    queued(sessionId: string): UserMessage[];
    observe(session: Session, event: SessionEvent): void;
    /** Cache-only read for the final synchronous cancel/steer check. */
    currentHumanTurn(sessionId: string): string | undefined;
    /** Native handoff evidence survives cancellation, compaction and an empty runtime cache. */
    wasHanded(sessionId: string, eventId: string, rule?: HandoffRule): Promise<boolean>;
    /** One cold read serves every sample in the caller's ordered recovery scan. */
    handoffs(sessionId: string): Promise<(eventId: string, rule?: HandoffRule) => boolean>;
    /** Last local human arrival; a delayed commit does not create a new interrupt budget. */
    humanTurn(sessionId: string): Promise<string>;
    read(sessionId: string, currentHumanId: string): Promise<DeliveryState>;
    close(): void;
};
