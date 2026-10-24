import type { CareTopic } from './care-changes.js';
/** One connection for all retained Sessions; no heartbeat or timed reconnect. */
export declare function createClientChanges({ fetcher, report }?: {
    fetcher?: typeof fetch | undefined;
    report?: ((error: unknown) => void) | undefined;
}): {
    subscribe(id: string, listener: (topics: readonly CareTopic[]) => void): () => void;
    reset: () => void;
    retry(): void;
    dispose(): void;
};
