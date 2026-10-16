const SCOPE_KEYS = new Set(['sessionIds', 'agentPresets']);
function list(name, value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.length === 0)
        throw new TypeError(`${name} must be a non-empty array`);
    const values = [];
    const seen = new Set();
    for (const item of value) {
        if (typeof item !== 'string' || item.length === 0 || item.length > 256) {
            throw new TypeError(`${name} entries must be non-empty strings up to 256 characters`);
        }
        if (!seen.has(item)) {
            seen.add(item);
            values.push(item);
        }
    }
    return values;
}
/** Parse external recipient configuration before it enters the runtime. */
export function normalizeScope(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new TypeError('reminder scope must be an object');
    for (const key of Object.keys(input)) {
        if (!SCOPE_KEYS.has(key))
            throw new TypeError(`unknown reminder scope field: ${key}`);
    }
    const sessionIds = list('sessionIds', 'sessionIds' in input ? input.sessionIds : undefined);
    const agentPresets = list('agentPresets', 'agentPresets' in input ? input.agentPresets : undefined);
    return { ...(sessionIds === undefined ? {} : { sessionIds }), ...(agentPresets === undefined ? {} : { agentPresets }) };
}
/** Match every declared recipient dimension against one session identity. */
export function matchesScope(identity, scope) {
    if (scope.sessionIds !== undefined && !scope.sessionIds.includes(identity.sessionId))
        return false;
    if (scope.agentPresets !== undefined &&
        (identity.agentPreset === undefined || !scope.agentPresets.includes(identity.agentPreset)))
        return false;
    return true;
}
//# sourceMappingURL=scope.js.map