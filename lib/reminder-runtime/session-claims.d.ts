import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
/** Native corpus/inbox access only; quota reconciliation and ledger publication belong to the engine. */
export declare function createSessionClaims(ctx: Context, now?: () => number): {
    observe(session: Session, event: SessionEvent): void;
    created: (session: Session) => void;
    update(change: (current: import("@leolee9086/dsh-rule-engine").ClaimBookValue) => import("@leolee9086/dsh-rule-engine").ClaimBookValue): Promise<import("@leolee9086/dsh-rule-engine").ClaimBookValue>;
    close(): Promise<void>;
};
