/** Process-local invalidations; Session and the owning services retain all facts. */
export type CareTopic = 'status' | 'actions' | 'prompts' | 'rewrites' | 'controls' | 'runtime';
export interface CareChange {
    sessionId?: string;
    topics: readonly CareTopic[];
}
export declare function createCareChanges(): {
    changed(sessionId: string | undefined, topics: readonly CareTopic[]): void;
    subscribe(listener: (change: CareChange) => void): () => void;
    close(): void;
};
