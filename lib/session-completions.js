import { createHash } from 'node:crypto';
import { requestDecision } from './request-replay.js';
function keyOf(sessionId, eventSeq) {
    return createHash('sha256').update(JSON.stringify({ sessionId, eventSeq })).digest('hex');
}
function receivedOutput(stream) {
    return stream.some(record => record.type !== 'chunk'
        || record.chunk.type !== 'finish' || record.chunk.reason.kind === 'stop');
}
function sameRoute(left, right) {
    return left.provider === right.provider && left.model === right.model;
}
/**
 * Derive completion wording, cooldown and delivery from native Session facts.
 * Reservations only serialize live request preparation; no domain file is read or written.
 * @param options - native sessions, rule settings and bounded wording parser.
 * @returns the completion request contribution and disposable projection owner.
 */
export function createSessionCompletions(options) {
    let states = new WeakMap();
    const reservations = new Map();
    function apply(state, session, event) {
        if (event.type === 'request/header')
            state.header = event.data.header;
        // A fork inherits readable text, not its parent's local observation cooldown.
        if (event.seq < session.inheritedEventCount)
            return;
        if (event.type === 'step/start')
            state.prompt = undefined;
        const decision = requestDecision(event);
        if (decision?.prompt) {
            const keys = new Set(decision.prompt.segments.flatMap(segment => segment.ruleId === 'completion-observation' && typeof segment.completionKey === 'string'
                ? [segment.completionKey] : []));
            const receipt = { callId: decision.prompt.callId, keys };
            state.receipts.set(receipt.callId, receipt);
            state.prompt = receipt;
        }
        if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt')
            return;
        const prompt = state.prompt;
        state.prompt = undefined;
        const completed = event.type === 'assistant/message' && !event.data.interrupted;
        if (prompt?.keys.size && (completed || receivedOutput(event.data.stream)) && state.header) {
            for (const [key, notice] of state.notices) {
                if (notice.eventSeq >= event.seq || !sameRoute(notice.route, state.header.config)
                    || notice.status === 'dispatched' || notice.status === 'superseded')
                    continue;
                notice.status = prompt?.keys.has(key) ? 'dispatched' : 'superseded';
                if (prompt?.keys.has(key))
                    notice.callId = prompt.callId;
            }
        }
        if (!completed || event.type !== 'assistant/message' || !state.header || event.seq <= state.since)
            return;
        let length = 0;
        const parts = [];
        for (const block of event.data.message.content) {
            if (block.type !== 'text')
                continue;
            length += block.text.length + (parts.length ? 2 : 0);
            if (length > options.maxObservedChars)
                return;
            parts.push(block.text);
        }
        const candidate = options.parse(parts.join('\n\n'));
        if (!candidate || (state.lastCompletedAt !== undefined && event.time < state.lastCompletedAt + options.cooldownMs))
            return;
        state.lastCompletedAt = event.time;
        state.notices.set(keyOf(String(session.id), event.seq), {
            sessionId: String(session.id), eventSeq: event.seq,
            route: { provider: state.header.config.provider, model: state.header.config.model },
            ...candidate, deliveries: 0, maxDeliveries: options.maxDeliveries, status: 'pending',
        });
    }
    function read(session) {
        const since = options.since(session);
        let state = states.get(session);
        if (!state || state.since !== since) {
            state = { through: 0, since, notices: new Map(), receipts: new Map() };
            states.set(session, state);
        }
        for (const event of session.snapshotEvents(state.through))
            apply(state, session, event);
        state.through = session.seq;
        return state;
    }
    function notices(session) {
        const state = read(session);
        const result = new Map();
        for (const [key, cached] of state.notices) {
            const matching = [...state.receipts.values()].filter(receipt => receipt.keys.has(key));
            result.set(key, { ...cached, route: { ...cached.route }, deliveries: matching.length,
                ...(matching.length && cached.status === 'pending' ? { status: 'delivery-unknown',
                    callId: matching[matching.length - 1].callId } : {}) });
        }
        return result;
    }
    function selected(sessionId) {
        if (sessionId === undefined)
            return options.sessions.list();
        const session = options.sessions.get(sessionId);
        return session ? [session] : [];
    }
    return {
        /** Native persistence owns all durable work; this does not ACK a second store. */
        async flush(sessionId) {
            await Promise.all(selected(sessionId).map(session => options.sessions.flush(session)));
        },
        async reconcile(session) { if (options.active(session))
            read(session); },
        collect(session, request) {
            if (!options.active(session) || (request.purpose ?? 'conversation') !== 'conversation')
                return [];
            const held = new Set([...reservations.values()].filter(value => value.sessionId === String(session.id))
                .flatMap(value => [...value.keys]));
            return [...notices(session)].filter(([key, notice]) => !held.has(key)
                && (notice.status === 'pending' || notice.status === 'delivery-unknown')
                && notice.deliveries < notice.maxDeliveries && sameRoute(notice.route, request))
                .sort((left, right) => right[1].eventSeq - left[1].eventSeq).slice(0, 1).map(([key, notice]) => ({
                ruleId: 'completion-observation', version: '1', trigger: 'completion',
                provider: request.provider, model: request.model, purpose: 'conversation',
                sourceSeqs: [notice.eventSeq], completionKey: key,
                text: `上一份输出使用了“${notice.label}”等完成表述。它是输出措辞的观察结果。请依据实际请求、交付内容和验证记录核对完成范围；若仍有已授权工作，继续完成。`,
            }));
        },
        async reserve(session, segments, callId) {
            reservations.set(callId, { sessionId: String(session.id),
                keys: new Set(segments.flatMap(segment => segment.completionKey === undefined ? [] : [segment.completionKey])) });
        },
        async rollback(_session, callId) { reservations.delete(callId); },
        async dispatched(session, _segments, callId, _request) {
            reservations.delete(callId);
            read(session);
        },
        list(sessionId) {
            return selected(sessionId).filter(options.active).flatMap(session => [...notices(session).values()]);
        },
        /** Release derived state; the next request reconstructs it from the same events. */
        clear() { states = new WeakMap(); reservations.clear(); },
        close() { states = new WeakMap(); reservations.clear(); },
    };
}
//# sourceMappingURL=session-completions.js.map