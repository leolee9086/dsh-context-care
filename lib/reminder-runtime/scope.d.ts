export interface RecipientIdentity {
    sessionId: string;
    agentPreset?: string;
    agentPresetName?: string;
    provider?: string;
    model?: string;
}
export type RecipientFacts = Omit<RecipientIdentity, 'sessionId'>;
declare const fields: {
    readonly 'session.sessionId': "sessionId";
    readonly 'session.agentPreset': "agentPreset";
    readonly 'session.agentPresetName': "agentPresetName";
    readonly 'session.provider': "provider";
    readonly 'session.model': "model";
};
export type RecipientCondition = {
    kind: 'all';
    conditions: RecipientCondition[];
} | {
    kind: 'any';
    conditions: RecipientCondition[];
} | {
    kind: 'not';
    condition: RecipientCondition;
} | {
    kind: 'compare';
    field: keyof typeof fields;
    op: 'exists';
} | {
    kind: 'compare';
    field: keyof typeof fields;
    op: 'eq' | 'ne' | 'contains';
    value: string;
};
export type RecipientScope = {
    sessionIds?: string[];
    agentPresets?: string[];
    condition?: RecipientCondition;
};
/** Parse external recipient configuration before it enters the runtime. */
export declare function normalizeScope(input?: unknown): RecipientScope;
/** Every declared dimension intersects; names and model IDs are case-sensitive. */
export declare function matchesScope(identity: RecipientIdentity, scope: RecipientScope): boolean;
export {};
