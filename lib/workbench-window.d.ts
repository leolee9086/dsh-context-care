import type { IndexedProjection } from './session-log.js';
interface Address {
    id: string;
    seq?: number;
    messageId?: string;
    turnId?: string;
}
type Unit = 'message' | 'turn' | 'block';
interface RuleWindow {
    select: {
        depth?: {
            unit: Unit;
            limit: number;
        };
    };
}
/**
 * Keep one append-only block index per workbench source. A positional replacement
 * must change generation. Depth counts identities before role/type filtering, as
 * the rule engine does. Noncontiguous duplicate identities retain the full prefix
 * because a suffix would change the engine's first-occurrence ordering.
 */
export declare function createWorkbenchWindow(): <T extends Address>(source: IndexedProjection<T>, rules: readonly RuleWindow[], maxSeq?: number, nextGeneration?: number) => readonly T[];
export {};
