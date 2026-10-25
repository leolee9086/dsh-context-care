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
import { Event } from './state.js';
/** Only the actual accepted event determines source, causation, payload and time. */
export function nativeSessionEvent(sessionId, event) {
    const data = event.data;
    let origin = 'background';
    let causationId;
    if (typeof data === 'object' && data !== null && 'source' in data
        && typeof data.source === 'object' && data.source !== null
        && 'kind' in data.source && data.source.kind === 'plugin:dsh-context-care:reminder') {
        origin = 'reminder';
        const trace = 'contextCareTrace' in data.source ? data.source.contextCareTrace : undefined;
        if (typeof trace === 'object' && trace !== null && 'sourceId' in trace && 'ruleId' in trace
            && typeof trace.sourceId === 'string' && typeof trace.ruleId === 'string') {
            causationId = `${trace.sourceId}:${trace.ruleId}`;
        }
    }
    else if (event.type === 'user/message')
        origin = 'human';
    else if (event.type.startsWith('tool/'))
        origin = 'tool';
    const callId = `${event.type}#${event.seq}`;
    return Event.parse({ type: 'session.event', sessionId, name: event.type, arguments: data, callId, rootCallId: callId,
        origin, ...(causationId === undefined ? {} : { causationId }), clock: { at: event.time }, facts: {},
        native: { type: 'session-event', seq: event.seq } });
}
/** An anchored caller cannot override any part of a committed Session event. */
export async function resolveNativeSessionEvent(event, history, signal) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        if (event.native?.type !== 'session-event')
            return event;
        signal?.throwIfAborted();
        const log = await history.readSession(event.sessionId);
        const lease = __addDisposableResource(env_1, { [Symbol.dispose]: () => log[Symbol.dispose]?.() }, false);
        signal?.throwIfAborted();
        const native = log.at ? log.at(event.native.seq) : log.events[event.native.seq];
        const inherited = log.inheritedEventCount ?? history.sessions.get(event.sessionId)?.inheritedEventCount;
        if (!native || native.seq !== event.native.seq || inherited === undefined || native.seq < inherited) {
            throw new Error('reminder-native-session-event-not-found');
        }
        return nativeSessionEvent(event.sessionId, native);
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        __disposeResources(env_1);
    }
}
//# sourceMappingURL=native-session-events.js.map