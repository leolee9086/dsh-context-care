import { requestDecision } from './request-replay.js';
/** A received non-error chunk establishes a stream; an error alone does not establish handoff. */
function receivedOutput(stream) {
    return stream.some(record => record.type !== 'chunk'
        || (record.chunk.type !== 'finish' || record.chunk.reason.kind === 'stop'));
}
function requestRecord(sessionId, event, header) {
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
        const completed = event.type === 'assistant/message' && !event.data.interrupted;
        const callId = `session:${sessionId}:request:${event.seq}`;
        return { key: `call_${callId}`, version: 1, sessionId, kind: 'request', at: event.time,
            data: { callId, logRevision: event.seq, dispatchOrder: event.seq, purpose: 'conversation', phase: 'settled',
                ...(completed || receivedOutput(event.data.stream) ? { dispatched: true } : {}),
                outcome: completed ? 'completed' : event.type === 'assistant/message' ? 'interrupted' : 'failed',
                eventSeq: event.seq, eventType: event.type,
                ...(header === undefined ? {} : { route: header.config, sourceHeader: header }),
                ...(event.type === 'assistant/message' && event.data.usage !== undefined ? { usage: event.data.usage } : {}) } };
    }
    if (event.type === 'compaction/summary' && event.data.llmStreamCall === true) {
        const callId = `session:${sessionId}:compaction:${event.data.compactionId}`;
        return { key: `call_${callId}`, version: 1, sessionId, kind: 'request', at: event.time,
            data: { callId, logRevision: event.seq, dispatchOrder: event.seq, purpose: 'compaction', phase: 'settled',
                dispatched: true, outcome: 'completed', eventSeq: event.seq, eventType: event.type, compactionId: event.data.compactionId,
                route: { provider: event.data.provider, model: event.data.model },
                ...(event.data.usage === undefined ? {} : { usage: event.data.usage }) } };
    }
    return undefined;
}
/**
 * Own a disposable incremental request index. Cached rows reference immutable log
 * values; no request body, tool schema, or header is serialized into another file.
 * @returns Session-scoped read and release operations.
 */
export function createRequestHistory() {
    let projections = new WeakMap();
    return {
        /** Read settled requests, consuming only events appended since the last read. */
        read(session) {
            const previous = projections.get(session);
            const events = previous ? session.snapshotEvents(previous.through) : session.snapshotEvents();
            const state = previous ?? { through: session.seq, requests: [] };
            for (const event of events) {
                if (event.type === 'request/header')
                    state.header = event.data.header;
                if (event.type === 'step/start') {
                    state.prompt = undefined;
                    state.workbench = undefined;
                }
                const decision = requestDecision(event);
                if (decision?.prompt)
                    state.prompt = { ...decision.prompt, seq: decision.seq };
                state.workbench = decision?.workbench ?? state.workbench;
                const request = requestRecord(String(session.id), event, state.header);
                if (request) {
                    const loggedId = state.prompt?.callId ?? state.workbench?.callId;
                    if (loggedId) {
                        request.data.callId = loggedId;
                        request.key = `call_${loggedId}`;
                    }
                    if (state.prompt)
                        request.data.promptDecision = state.prompt;
                    if (state.workbench)
                        request.data.workbenchDecision = state.workbench;
                    state.requests.push(request);
                    state.prompt = undefined;
                    state.workbench = undefined;
                }
            }
            state.through = session.seq;
            projections.set(session, state);
            return state.requests;
        },
        /** Drop derived rows; the next read reconstructs them from the same Session. */
        clear() { projections = new WeakMap(); },
    };
}
//# sourceMappingURL=request-history.js.map