var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { createHash } from 'node:crypto';
import { requestDecision } from './request-replay.js';
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyFor = (sessionId, rule) => fingerprint({ sessionId, rule });
const sameRoute = (left, right) => left.provider === right.provider && left.model === right.model;
function receivedOutput(stream) {
    return stream.some(record => record.type !== 'chunk'
        || record.chunk.type !== 'finish' || record.chunk.reason.kind === 'stop');
}
function requireMeasured(sample) {
    if (sample.status !== 'measured' || typeof sample.H !== 'number' || typeof sample.K !== 'number'
        || typeof sample.N !== 'number' || !Array.isArray(sample.evidence)) {
        throw new Error('context-care: output trigger requires measured native evidence');
    }
}
/**
 * Derive output-pattern episodes from successful native output and actual request inputs.
 * The only live-only state coordinates preparation; no feedback domain is opened.
 * @param options - existing Session service, rule definitions and deterministic parser.
 * @returns the request contribution and disposable native projection owner.
 */
export function createSessionOutputFeedback(options) {
    const stateKey = options.logs.cache.define('output-feedback', 'Native Session identity; rule signature, settings revision and committed event cursor.', () => ({
        through: 0, receipts: new Set(), episodes: new Map(),
    }));
    const reservations = new Map();
    function apply(state, session, event, rules) {
        if (event.type === 'request/header')
            state.header = event.data.header;
        if (event.seq < session.inheritedEventCount)
            return;
        if (event.type === 'step/start')
            state.prompt = undefined;
        const decision = requestDecision(event);
        if (decision?.prompt) {
            const prompt = decision.prompt;
            const keys = new Set();
            const duplicate = state.receipts.has(prompt.callId);
            for (const segment of prompt.segments) {
                if (typeof segment.feedbackKey !== 'string' || !Array.isArray(segment.sourceSeqs) || keys.has(segment.feedbackKey))
                    continue;
                const episode = state.episodes.get(segment.feedbackKey), pending = episode?.pending;
                // The logged source positions identify the episode even for older random segment ids.
                if (!episode || !pending || JSON.stringify(segment.sourceSeqs) !== JSON.stringify(pending.sourceSeqs))
                    continue;
                keys.add(segment.feedbackKey);
                if (duplicate)
                    continue;
                pending.deliveries++;
                episode.lastDelivery = { segmentId: pending.segmentId, callId: prompt.callId,
                    status: 'delivery-unknown', attempts: pending.deliveries };
            }
            state.prompt = { callId: prompt.callId, keys };
            if (keys.size)
                state.receipts.add(prompt.callId);
        }
        if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt')
            return;
        const prompt = state.prompt;
        state.prompt = undefined;
        const completed = event.type === 'assistant/message' && !event.data.interrupted;
        const route = state.header?.config;
        if (!route)
            return;
        if (completed || receivedOutput(event.data.stream)) {
            for (const [key, episode] of state.episodes) {
                const pending = episode.pending;
                if (!pending || episode.lastSeq >= event.seq)
                    continue;
                if (prompt?.keys.has(key)) {
                    episode.lastDelivery = { ...episode.lastDelivery, segmentId: pending.segmentId, callId: prompt.callId, status: 'dispatched' };
                    delete episode.pending;
                }
                else if (!sameRoute(episode.route, route)) {
                    episode.lastDelivery = { segmentId: pending.segmentId, callId: prompt?.callId ?? `session:${session.id}:request:${event.seq}`, status: 'superseded' };
                    delete episode.pending;
                }
            }
        }
        if (!completed || event.type !== 'assistant/message')
            return;
        const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n');
        for (const rule of rules) {
            const detector = rule.detector;
            if (rule.trigger !== 'output-pattern' || !detector || !sameRoute(rule, route)
                || !options.eligible(String(session.id), rule.ruleId, [event.seq]))
                continue;
            const key = keyFor(String(session.id), rule);
            let episode = state.episodes.get(key);
            if (!episode) {
                episode = { version: 1, sessionId: String(session.id), ruleId: rule.ruleId, ruleVersion: rule.version,
                    specHash: fingerprint(detector), route: { provider: route.provider, model: route.model },
                    lastSeq: event.seq, completed: 0, cooldownUntil: 0, healthy: 0, window: [] };
                state.episodes.set(key, episode);
            }
            const sample = { ...options.detect(text, detector), seq: event.seq };
            episode.lastSeq = event.seq;
            episode.completed++;
            episode.window = [...episode.window, sample].slice(-detector.windowOutputs);
            const trigger = options.trigger(sample, episode.window, detector);
            if (episode.pending && episode.pending.deliveries >= episode.pending.maxDeliveries) {
                if (episode.lastDelivery)
                    episode.lastDelivery.exhausted = true;
                delete episode.pending;
            }
            episode.healthy = sample.status === 'measured' && sample.K === 0 ? episode.healthy + 1 : 0;
            if (episode.healthy >= detector.rearmHealthyOutputs)
                episode.cooldownUntil = 0;
            if (trigger !== undefined && !episode.pending && episode.completed > episode.cooldownUntil) {
                requireMeasured(sample);
                const sourceSeqs = trigger === 'window' ? episode.window.map(value => value.seq) : [event.seq];
                episode.pending = { segmentId: fingerprint({ key, sourceSeqs }), sourceSeqs, sample, trigger,
                    deliveries: 0, maxDeliveries: detector.maxDeliveries };
                episode.cooldownUntil = episode.completed + detector.cooldownCompletedOutputs;
            }
        }
    }
    function read(session, rules = options.rulesFor(String(session.id))) {
        const signature = fingerprint({ rules, revision: options.revision(String(session.id)) });
        const state = options.logs.cache.use(session, stateKey, [signature]);
        // With no output detector there is no episode to reconstruct. Adding one
        // changes the signature and starts a fresh fold from the native history.
        if (!rules.some(rule => rule.trigger === 'output-pattern')) {
            state.through = session.seq;
            return state;
        }
        try {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const log = __addDisposableResource(env_1, options.logs.live(session), false);
                for (const event of log.select(['request/header', 'step/start', 'assistant/message', 'assistant/attempt'], state.through)) {
                    apply(state, session, event, rules);
                    state.through = event.seq + 1;
                    options.logs.cache.worked(stateKey);
                }
                state.through = log.length;
                return state;
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        }
        catch (error) {
            // Parser failures must not publish partial counters; the next read replays native facts.
            options.logs.cache.invalidate(session, stateKey);
            throw error;
        }
    }
    function selected(sessionId) {
        if (sessionId === undefined)
            return options.sessions.list();
        const session = options.sessions.get(sessionId);
        return session ? [session] : [];
    }
    return {
        /** Canonical output already exists in Session; callback copies cannot change it. */
        async observe(session, _event, _route, rules) { read(session, rules); },
        collect(session, request, rules) {
            if ((request.purpose ?? 'conversation') !== 'conversation')
                return [];
            const state = read(session, rules), segments = [], used = new Set();
            const held = new Set([...reservations.values()].filter(value => value.sessionId === String(session.id)).flatMap(value => [...value.keys]));
            for (const rule of rules) {
                if (rule.trigger !== 'output-pattern' || !sameRoute(rule, request))
                    continue;
                const ownKey = keyFor(String(session.id), rule);
                for (const [key, episode] of state.episodes) {
                    if (key !== ownKey && !(rule.carryFromOtherRoute && !sameRoute(episode.route, request)))
                        continue;
                    const pending = episode.pending;
                    if (!pending || pending.deliveries >= pending.maxDeliveries || used.has(key) || held.has(key)
                        || !options.eligible(String(session.id), rule.ruleId, pending.sourceSeqs))
                        continue;
                    used.add(key);
                    const values = { boundModelLabel: `${request.provider}/${request.model}`, sourceModel: `${episode.route.provider}/${episode.route.model}`,
                        H: pending.sample.H, K: pending.sample.K, N: pending.sample.N, examples: pending.sample.evidence.map(hit => `“${hit.text}”`).join('、') };
                    let text = rule.text;
                    for (const [name, value] of Object.entries(values))
                        text = text.replaceAll(`{${name}}`, String(value));
                    segments.push({ ruleId: rule.ruleId, version: rule.version, trigger: 'output-pattern', provider: request.provider, model: request.model,
                        purpose: 'conversation', text, segmentId: pending.segmentId, sourceRoute: { ...episode.route }, sourceSeqs: [...pending.sourceSeqs],
                        metrics: structuredClone(pending.sample), feedbackKey: key });
                }
            }
            return segments;
        },
        async reserve(session, segments, callId) {
            reservations.set(callId, { sessionId: String(session.id), keys: new Set(segments.flatMap(segment => segment.feedbackKey ? [segment.feedbackKey] : [])) });
        },
        async rollback(_session, callId) { reservations.delete(callId); },
        async dispatched(session, _segments, callId, _request) {
            reservations.delete(callId);
            read(session);
        },
        async flush(sessionId) { await Promise.all(selected(sessionId).map(session => options.sessions.flush(session))); },
        list(sessionId) { return selected(sessionId).flatMap(session => [...read(session).episodes.values()].map(value => structuredClone(value))); },
        clear() { options.logs.cache.clear(stateKey); reservations.clear(); },
        async close() { options.logs.cache.clear(stateKey); reservations.clear(); },
    };
}
//# sourceMappingURL=session-output-feedback.js.map