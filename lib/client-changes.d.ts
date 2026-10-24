import { type CareSubscriptionInput, type CareUpdate } from './care-stream.js';
type Observer = (update: CareUpdate) => void;
/** One connection carries data for every retained view. There are no notification-triggered GETs.
 * Membership changes, explicit refresh and native connection reset open a fresh snapshot stream. */
export declare function createClientChanges({ fetcher, report }?: {
    fetcher?: typeof fetch | undefined;
    report?: ((error: unknown) => void) | undefined;
}): {
    subscribe(input: CareSubscriptionInput, listener: Observer): () => void;
    reset: () => void;
    refresh: () => void;
    dispose(): void;
};
export {};
