import type { SessionCache } from './session-cache.js';
/** One planning operation borrows immutable bodies; envelope ids and positions stay per view. */
export declare function createRequestModelProjection<M extends object, B>(cache: SessionCache, project: (message: M) => readonly B[]): {
    read(message: M): readonly B[];
    system(text: string, message: M): readonly B[];
    /** The planner has just cloned all messages but has not edited any payload yet. */
    cloned(before: readonly M[], after: readonly M[]): void;
    /** Detach the cloned message before its first payload edit; old cuts stay valid. */
    changed(message: M): void;
    close(): void;
};
