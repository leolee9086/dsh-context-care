import type { SessionLog } from './session-log.js';
import { createDiagnosticRecordFeed } from './diagnostic-pages.js';
import { z } from 'zod';
declare const Rewrite: z.ZodObject<{
    hash: z.ZodString;
    sessionId: z.ZodString;
}, z.core.$catchall<z.ZodJSONSchema>>;
export type RewriteValue = z.infer<typeof Rewrite>;
/** Internal token, not a JSON record or an independent cache registry.
 * The owning Session entry holds it; subscribers keep only their active reader. */
declare class RewriteView {
    readonly feed: ReturnType<typeof createDiagnosticRecordFeed<RewriteValue>>;
    private readonly build;
    private rows?;
    constructor(feed: ReturnType<typeof createDiagnosticRecordFeed<RewriteValue>>, build: () => readonly RewriteValue[]);
    snapshot(): readonly RewriteValue[];
}
export declare function rewriteCut(value: unknown): RewriteView | undefined;
export declare function rewriteSnapshot(value: object): readonly RewriteValue[];
/** Reproducible views live in the unified Host cache, never in another journal.
 * The legacy index has no revision/invalidation contract, so it is still read.
 * Its unchanged rows are compared once here, not serialized by every subscriber. */
export declare function createRewriteProjection(logs: SessionLog): {
    read(owner: object, sessionId: string, local: readonly {
        value: object;
    }[], durable: readonly object[], legacy: readonly object[]): object;
    close(): void;
};
export {};
