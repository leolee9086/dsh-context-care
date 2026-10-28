import { createDeliveryRuntime } from '@leolee9086/dsh-rule-engine';
import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session';
type DeliveryRuntime = ReturnType<typeof createDeliveryRuntime<Session, UserMessage>>;
type SessionDeliveries = Omit<DeliveryRuntime, 'observe'> & {
    observe(session: Session, event: SessionEvent): void;
};
/** The Host owns exact Session identities, immutable cuts, cache generations and native inbox access. */
export declare function createSessionDeliveries(ctx: Context, now?: () => number): SessionDeliveries;
export type DeliveryState = Awaited<ReturnType<ReturnType<typeof createSessionDeliveries>['read']>>;
export {};
