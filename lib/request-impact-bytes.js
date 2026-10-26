const requestFields = ['provider', 'model', 'reasoningEffort', 'temperature', 'maxTokens', 'stop', 'system', 'tools', 'messages'];
/** Capture the complete public JSON estimate, preserving its original field order. */
export function publicRequestBytes(request) {
    const payload = request;
    return Buffer.from(JSON.stringify(Object.fromEntries(requestFields.filter(key => payload[key] !== undefined)
        .map(key => [key, payload[key]]))), 'utf8');
}
//# sourceMappingURL=request-impact-bytes.js.map