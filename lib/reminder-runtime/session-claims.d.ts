import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import { type ClaimBookValue } from './claims.js';
/**
 * Shared quota is derived from delivered messages and the native pending inbox.
 * Only reservations not yet accepted into that inbox live solely in this cache.
 * @param ctx the owning Host context, including its native Session query service
 * @param now the clock used to discard expired quota windows
 * @returns serialized quota transitions and synchronous committed-event observation
 */
export declare function createSessionClaims(ctx: Context, now?: () => number): {
    /** Observe delivery commits without turning inbox acceptance into consumption. */
    observe(session: Session, event: SessionEvent): void;
    /** A newly restored Session may contain commits published before this owner existed. */
    created(session: Session): void;
    /** Serialize cross-session reservations; no domain file or ACK participates. */
    update(change: (current: ClaimBookValue) => ClaimBookValue): Promise<ClaimBookValue>;
    /** Await owned reads and reservations before releasing this disposable cache. */
    close(): Promise<void>;
};
