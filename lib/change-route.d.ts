import type { Context } from '@deepseek-ai/cordis';
import type { createCareChanges } from './care-changes.js';
import { type CareSubscriptionValue } from './care-stream.js';
type Reader = (query: CareSubscriptionValue, signal: AbortSignal) => Promise<unknown>;
/** One authenticated connection pushes the subscribed data, including its initial snapshot.
 * Each view has one pending read; backpressure coalesces changes instead of queuing bodies.
 * A failed view reports its original exception and waits for an explicit resubscription. */
export declare function installChangeRoute(ctx: Context, changes: ReturnType<typeof createCareChanges>, read: Reader): () => void;
export {};
