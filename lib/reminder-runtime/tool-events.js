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
import { nativeSessionEvent, resolveNativeSessionEvent } from './native-session-events.js';
import { requestContext } from './request-context.js';
import { nativeOutputSamples } from './native-output-events.js';
/** Parse the model's raw arguments using the native dispatch rules. */
function argumentsOf(raw) {
    try {
        return raw ? JSON.parse(raw) : {};
    }
    catch {
        return raw;
    }
}
/** The logged call is the recoverable input boundary; replay does not execute its body. */
function beforeCall(sessionId, event) {
    if (event.type !== 'tool/call' && event.type !== 'tool/ptc-dispatch-start')
        throw new Error('reminder-native-tool-call-not-found');
    const callId = event.type === 'tool/call' ? String(event.data.callId) : String(event.data.subCallId);
    return Event.parse({ type: 'tool.before-execute', sessionId, callId,
        rootCallId: event.type === 'tool/call' ? callId : String(event.data.rootCallId), name: event.data.name,
        arguments: event.type === 'tool/call' ? argumentsOf(event.data.arguments) : event.data.arguments,
        clock: { at: event.time }, native: { type: 'tool-call', seq: event.seq }, facts: {} });
}
/** The native PTC route rejection happens before the extensible pre-execute pipeline. */
function collapsedCall(event, name) {
    if (event.type !== 'tool/result' || event.data.error?.code !== 'UNKNOWN_TOOL'
        || event.data.error.name !== 'ToolNotFoundError')
        return false;
    const content = event.data.message.content;
    // UNKNOWN_TOOL alone is insufficient: an actually unknown name still enters
    // pre-execute. The registry's collapsed-name result includes this exact route.
    const text = `Error: unknown tool "${name}": only \`run_code\` is callable directly — call \`${name}\` from inside a \`run_code\` program instead`;
    return content.length === 1 && content[0].type === 'text' && content[0].text === text;
}
/** Build one trigger from committed outcome fields and its historical context. */
function result(config, sessionId, terminal, callId, call, isError, code, messages, excludeMessageId) {
    const visible = messages.filter(message => message.id !== excludeMessageId);
    return { event: Event.parse({ type: isError ? 'tool.failed' : 'tool.succeeded',
            sessionId, callId, rootCallId: call.rootCallId, name: call.name, arguments: call.arguments,
            ...(isError ? { error: { code } } : {}), clock: { at: terminal.time }, context: requestContext(visible, config),
            native: { type: 'tool-result', seq: terminal.seq },
        }) };
}
/** One assistant settlement can contain several distinct native output samples. */
function cacheKey(event) {
    const position = event.native;
    if (!position)
        throw new Error('reminder-native-tool-position-missing');
    const key = `${position.type}:${position.seq}`;
    return position.type === 'assistant-output' ? `${key}:${event.callId}` : key;
}
/**
 * Derive tool reminders from actual committed call/result events. Both maps are
 * disposable; neither records a judge outcome or acknowledges a reminder.
 * @param config - matcher context bounds and live admission capacity.
 * @param history - native reads and detached preparation used after cache loss.
 * @returns the live event fold, canonical trigger resolution and lifecycle release.
 */
export function createToolEvents(config, history) {
    const cache = history.logs.cache;
    const stateKey = cache.define('reminder-tool-events', 'Native Session identity and immutable anchored submissions; bounds follow live queue capacity.', () => ({ calls: new Map(), events: new Map() }));
    const rejectedKey = cache.define('reminder-before-call-rejections', 'Immutable log owner and appended native dispatch terminal evidence, bounded by each reader cut.', () => ({ through: 0, names: new Map(), skipped: new Map() }));
    function unobservedBeforeCall(log, callId) {
        const state = cache.use(log.owner, rejectedKey);
        try {
            for (const event of log.select(['tool/call', 'tool/result', 'tool/ptc-dispatch'], state.through)) {
                if (event.type === 'tool/call')
                    state.names.set(String(event.data.callId), event.data.name);
                else if (event.type === 'tool/result') {
                    const id = String(event.data.message.toolCallId), name = state.names.get(id);
                    if (event.data.error?.code === 'ABORTED_BEFORE_DISPATCH' || name !== undefined && collapsedCall(event, name)) {
                        state.skipped.set(id, Math.min(state.skipped.get(id) ?? event.seq, event.seq));
                    }
                    state.names.delete(id);
                }
                else if (event.type === 'tool/ptc-dispatch' && event.data.error?.code === 'ABORTED_BEFORE_DISPATCH') {
                    const id = String(event.data.subCallId);
                    state.skipped.set(id, Math.min(state.skipped.get(id) ?? event.seq, event.seq));
                }
                cache.worked(rejectedKey);
            }
            state.through = Math.max(state.through, log.length);
            const rejected = state.skipped.get(callId);
            return rejected !== undefined && rejected < log.length;
        }
        catch (error) {
            cache.invalidate(log.owner, rejectedKey);
            throw error;
        }
    }
    const limit = config.maxQueued + config.maxConcurrent;
    function put(session, id, call) {
        cache.use(session, stateKey).calls.set(id, call);
    }
    function take(session, id) {
        const pending = cache.peek(session, stateKey)?.calls, call = pending?.get(id);
        pending?.delete(id);
        return call;
    }
    function remember(session, submission) {
        if (!session)
            return submission;
        const events = cache.use(session, stateKey).events;
        const position = submission.event.native;
        if (!position)
            throw new Error('reminder-native-tool-position-missing');
        // Submission recipients can annotate their copy; the private cache retains
        // an independent value so that such changes cannot replace native facts.
        events.set(cacheKey(submission.event), structuredClone(submission.event));
        while (events.size > limit) {
            const first = events.keys().next();
            if (!first.done)
                events.delete(first.value);
        }
        return submission;
    }
    /** Interpret one native result against its original prefix, never the current surface. */
    function fromLog(sessionId, terminal, prefix) {
        if (terminal.type !== 'tool/result' && terminal.type !== 'tool/ptc-dispatch') {
            throw new Error('reminder-native-tool-result-not-found');
        }
        const code = terminal.data.error?.code;
        if (code === 'ABORTED_BEFORE_DISPATCH')
            throw new Error('reminder-native-tool-result-not-dispatched');
        // Native interpretation preserves replacements and content projections at
        // this boundary. A later surface cannot substitute for the historical input.
        const messages = prefix.messages;
        if (terminal.type === 'tool/ptc-dispatch') {
            const data = terminal.data;
            return result(config, sessionId, terminal, String(data.subCallId), { name: data.name,
                arguments: data.arguments, rootCallId: String(data.rootCallId) }, data.isError, code, messages);
        }
        const { message } = terminal.data, id = String(message.toolCallId);
        const call = prefix.call;
        if (!call)
            throw new Error('reminder-native-tool-call-not-found');
        return result(config, sessionId, terminal, id, call, message.isError === true, code, messages);
    }
    function* outputSamples(session, log, terminal) {
        if (!config.output)
            throw new Error('reminder-native-output-config-missing');
        for (const sample of nativeOutputSamples(config.output, session, log, terminal, error => { throw error; })) {
            yield { event: Event.parse({ ...sample.event, native: { type: 'assistant-output', seq: terminal.seq } }), afterCommit: sample.afterCommit };
        }
    }
    return {
        /** Cache the actual native event separately from a tool outcome at the same seq. */
        observeSession(session, event) {
            return remember(session, { event: nativeSessionEvent(String(session.id), event) }).event;
        },
        /** Only an actual logged call can supply a native anchor for the execution hook. */
        preparation(session, callId) {
            const seq = cache.peek(session, stateKey)?.calls.get(callId)?.nativeSeq;
            return seq === undefined ? undefined : { type: 'tool-call', seq };
        },
        /** A paired native call publishes its result after the execution hook. */
        waitForCommit(session, callId) {
            return cache.peek(session, stateKey)?.calls.has(callId) === true;
        },
        /** Fold the synchronous post-commit feed; old events must use resolve instead. */
        observe(session, event) {
            if (event.type === 'tool/call') {
                put(session, String(event.data.callId), { nativeSeq: event.seq, name: event.data.name,
                    arguments: argumentsOf(event.data.arguments), rootCallId: String(event.data.callId) });
                remember(session, { event: beforeCall(String(session.id), event) });
            }
            else if (event.type === 'tool/ptc-dispatch-start') {
                put(session, String(event.data.subCallId), { nativeSeq: event.seq, name: event.data.name,
                    arguments: event.data.arguments, rootCallId: String(event.data.rootCallId) });
                remember(session, { event: beforeCall(String(session.id), event) });
            }
            else if (event.type === 'tool/result' || event.type === 'tool/ptc-dispatch') {
                // A final surface contains later messages and later content projections.
                // It cannot supply an old trigger's matcher or judge context.
                if (session.seq !== event.seq + 1)
                    throw new Error('reminder-native-tool-context-is-not-current');
                if (event.type === 'tool/result') {
                    const { message, error } = event.data, id = String(message.toolCallId), call = take(session, id);
                    if (call?.nativeSeq !== undefined && (error?.code === 'ABORTED_BEFORE_DISPATCH' || collapsedCall(event, call.name))) {
                        cache.peek(session, stateKey)?.events.delete(`tool-call:${call.nativeSeq}`);
                    }
                    // Mid-call installation remains on the unpaired tools/result path.
                    if (call && error?.code !== 'ABORTED_BEFORE_DISPATCH') {
                        return remember(session, result(config, String(session.id), event, id, call, message.isError === true, error?.code, history.logs.tail(session, config.maxContextMessages, String(message.id))));
                    }
                }
                else {
                    const data = event.data, id = String(data.subCallId), call = take(session, id);
                    if (data.error?.code === 'ABORTED_BEFORE_DISPATCH' && call?.nativeSeq !== undefined) {
                        cache.peek(session, stateKey)?.events.delete(`tool-call:${call.nativeSeq}`);
                    }
                    if (data.error?.code !== 'ABORTED_BEFORE_DISPATCH') {
                        return remember(session, result(config, String(session.id), event, id, { name: data.name,
                            arguments: data.arguments, rootCallId: String(data.rootCallId) }, data.isError, data.error?.code, history.logs.tail(session, config.maxContextMessages)));
                    }
                }
            }
            return undefined;
        },
        /**
         * Resolve an anchored submission from its native log, including the model
         * surface immediately before that result. The detached prefix never enters
         * the live store or activates an Agent. Supplied copies of call facts do not win.
         */
        async resolve(event, signal) {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                if (!event.native)
                    return event;
                signal?.throwIfAborted();
                const session = history.sessions.get(event.sessionId);
                const hot = session && cache.peek(session, stateKey)?.events.get(cacheKey(event));
                if (hot)
                    return structuredClone(hot);
                if (event.native.type === 'session-event') {
                    return remember(session, { event: await resolveNativeSessionEvent(event, history, signal) }).event;
                }
                const log = await history.readSession(event.sessionId, signal);
                const lease = __addDisposableResource(env_1, { [Symbol.dispose]: () => log[Symbol.dispose]?.() }, false);
                signal?.throwIfAborted();
                if (event.native.type === 'assistant-output') {
                    const native = log.at(event.native.seq);
                    if (!native || native.seq !== event.native.seq || native.seq < log.inheritedEventCount
                        || (native.type !== 'assistant/message' && native.type !== 'assistant/attempt'))
                        throw new Error('reminder-native-output-not-found');
                    const view = { id: event.sessionId };
                    for (const sample of outputSamples(view, log, native))
                        if (sample.event.callId === event.callId) {
                            return remember(session, sample).event;
                        }
                    throw new Error('reminder-native-output-sample-not-found');
                }
                if (event.native.type === 'tool-call') {
                    const native = log.at(event.native.seq);
                    if (!native || native.seq !== event.native.seq || native.seq < log.inheritedEventCount) {
                        throw new Error('reminder-native-tool-call-not-found');
                    }
                    const canonical = beforeCall(event.sessionId, native);
                    if (unobservedBeforeCall(log, canonical.callId))
                        throw new Error('reminder-native-tool-call-not-dispatched');
                    return remember(session, { event: canonical }).event;
                }
                const terminal = log.at(event.native.seq);
                if (!terminal || terminal.seq !== event.native.seq || terminal.seq < log.inheritedEventCount
                    || (terminal.type !== 'tool/result' && terminal.type !== 'tool/ptc-dispatch')) {
                    throw new Error('reminder-native-tool-result-not-found');
                }
                if (terminal.data.error?.code === 'ABORTED_BEFORE_DISPATCH')
                    throw new Error('reminder-native-tool-result-not-dispatched');
                // A retry must reproduce the context at this exact terminal event. This is
                // an explicit historical read, never ordinary trigger rediscovery.
                const context = await history.logs.contextBefore(log, terminal, config.maxContextMessages, signal);
                const called = context.call;
                const prefix = { messages: context.messages, ...(called ? { call: { name: called.data.name,
                            arguments: argumentsOf(called.data.arguments), rootCallId: String(called.data.callId) } } : {}) };
                return remember(session, fromLog(event.sessionId, terminal, prefix)).event;
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        },
        /** Release process-local pairing and context caches without changing any log. */
        close() { cache.clear(stateKey); cache.clear(rejectedKey); },
    };
}
//# sourceMappingURL=tool-events.js.map