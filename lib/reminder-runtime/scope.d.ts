export type RecipientScope = {
    sessionIds?: string[];
    agentPresets?: string[];
};
export interface RecipientIdentity {
    sessionId: string;
    agentPreset?: string;
}
/** Parse external recipient configuration before it enters the runtime. */
export declare function normalizeScope(input?: unknown): RecipientScope;
/** Match every declared recipient dimension against one session identity. */
export declare function matchesScope(identity: RecipientIdentity, scope: RecipientScope): boolean;
