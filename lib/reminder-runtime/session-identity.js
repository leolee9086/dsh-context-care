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
import { ensureSessionLog } from '../session-log.js';
/** Read current recipient facts through the Host's shared native log access. */
export function createSessionIdentityResolver(ctx) {
    const history = ensureSessionLog(ctx);
    const selectionKey = history.cache.define('reminder-session-preset', 'Native Session identity and committed preset selection; service projections remain authoritative.', session => ({ known: session.firstLiveSeq === 0, value: session.header.agentPreset }));
    ctx.on('session/created', session => {
        if (session.firstLiveSeq === 0)
            history.cache.use(session, selectionKey);
    });
    ctx.on('session/event', (session, event) => {
        if (event.type !== 'agent-preset/selected')
            return;
        const state = history.cache.use(session, selectionKey);
        state.known = true;
        state.value = event.data.agentPreset ?? undefined;
    });
    ctx.effect(() => () => history.cache.clear(selectionKey));
    function currentPreset(session, log) {
        const projected = ctx.get('sessionProjections')?.stateOf(session, 'agentPreset');
        if (projected !== undefined)
            return projected ?? undefined;
        const cached = history.cache.use(session, selectionKey);
        if (cached.known)
            return cached.value;
        const event = log.last('agent-preset/selected');
        const value = event?.type === 'agent-preset/selected' ? event.data.agentPreset ?? undefined : log.header.agentPreset;
        cached.known = true;
        cached.value = value;
        return value;
    }
    return async (id, signal) => {
        const nativeId = id;
        for (;;) {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                signal?.throwIfAborted();
                const log = __addDisposableResource(env_1, await history.read(nativeId, signal), false);
                const session = ctx.sessions.get(nativeId) ?? log.prepare();
                const projections = ctx.get('sessionProjections'), presets = ctx.get('agentPresets');
                const agentPreset = currentPreset(session, log);
                const document = agentPreset === undefined ? undefined : await presets?.readDocument(agentPreset);
                signal?.throwIfAborted();
                const live = ctx.sessions.get(nativeId);
                if (live && live !== session)
                    continue;
                if (currentPreset(session, log) !== agentPreset)
                    continue;
                const agent = ctx.get('agents')?.get(nativeId);
                const defaults = agent ? presets?.serviceFor(agent, 'agentDefaultModel') : ctx.get('agentDefaultModel');
                const selection = projections?.stateOf(session, 'modelSelection')?.pending
                    ?? session.requestHeader()?.config ?? defaults?.currentSelection();
                return { ...(agentPreset === undefined ? {} : { agentPreset }),
                    ...(document?.name === undefined ? {} : { agentPresetName: document.name }),
                    ...(selection === undefined ? {} : { provider: selection.provider, model: selection.model }) };
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        }
    };
}
//# sourceMappingURL=session-identity.js.map