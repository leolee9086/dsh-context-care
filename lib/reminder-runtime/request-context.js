const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Local calendar windows use civil dates, including across midnight and DST changes. */
export function localWindow(spec, timestamp) {
    if (!spec || timestamp === undefined || !Number.isFinite(timestamp))
        return undefined;
    const date = new Date(timestamp);
    const minute = date.getHours() * 60 + date.getMinutes();
    const minutes = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
    const start = minutes(spec.start), end = minutes(spec.end);
    const overnight = start > end;
    if (overnight ? minute < start && minute >= end : minute < start || minute >= end)
        return undefined;
    const beginning = new Date(timestamp);
    if (overnight && minute < end)
        beginning.setDate(beginning.getDate() - 1);
    beginning.setHours(Math.floor(start / 60), start % 60, 0, 0);
    const ending = new Date(beginning);
    if (overnight)
        ending.setDate(ending.getDate() + 1);
    ending.setHours(Math.floor(end / 60), end % 60, 0, 0);
    const day = [beginning.getFullYear(), String(beginning.getMonth() + 1).padStart(2, '0'), String(beginning.getDate()).padStart(2, '0')].join('-');
    return { id: day, start: beginning.getTime(), end: ending.getTime() };
}
/**
 * Presence is recent input, not a session-global inventory of human message IDs.
 * Walk backwards only inside the interested rules' time window. A user/message
 * is a surface commit and can happen much later than input; it never refreshes presence.
 */
export function humanActivity(events, now, withinMs) {
    if (!Number.isFinite(now) || !Number.isFinite(withinMs) || withinMs <= 0)
        return null;
    const since = now - withinMs;
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events.at(index);
        if (!event)
            break;
        const data = event.data;
        // Stop at the child's ownership boundary, but retain recent input across an ordinary resume.
        if (event.type === 'session/end-seed' && record(data) && data.inherited === true)
            break;
        if (!Number.isFinite(event.time))
            continue;
        if (event.time < since)
            break;
        if (event.time > now || event.type !== 'agent/inbox/spliced'
            || !record(data) || !Array.isArray(data.inserted))
            continue;
        if (data.inserted.some((message) => record(message) && record(message.source)
            && message.source.kind === 'user' && typeof message.id === 'string' && message.id.length > 0)) {
            return { at: event.time, evidence: 'human-message' };
        }
    }
    return null;
}
export function requestContext(visible, config) {
    let chars = config.maxContextChars;
    const messages = [];
    for (const message of (config.maxContextMessages ? visible.slice(-config.maxContextMessages) : []).reverse()) {
        const text = (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
        messages.unshift({ role: message.role, text: chars ? text.slice(-chars) : '', truncated: text.length > chars });
        chars = Math.max(0, chars - text.length);
    }
    return { messages, truncated: messages.length < visible.length || messages.some(message => message.truncated) };
}
/** Built-in facts are evaluated before optional worker analysis and cannot be overwritten by it. */
export function requestEligible(rule, event) {
    if (rule.on !== (event.type ?? 'tool.succeeded'))
        return false;
    if (rule.on === 'tool.succeeded' || rule.on === 'tool.before-execute')
        return rule.when.tool === event.name;
    if (rule.on === 'session.event')
        return rule.when.eventType === event.name;
    if (rule.on === 'tool.failed')
        return rule.when.tool === event.name && rule.when.error?.code === event.error?.code;
    if (rule.on === 'assistant.output' && (!event.output || !rule.when.blockTypes.includes(event.output.type)))
        return false;
    if ('timeWindow' in rule.when && rule.when.timeWindow && !localWindow(rule.when.timeWindow, event.clock?.at))
        return false;
    if (rule.on === 'request.before' && rule.when.humanActivity) {
        const at = event.humanActivity?.at, now = event.clock?.at;
        if (at === undefined || now === undefined || !Number.isFinite(at) || !Number.isFinite(now)
            || at > now || now - at > rule.when.humanActivity.withinSeconds * 1000)
            return false;
    }
    return true;
}
//# sourceMappingURL=request-context.js.map