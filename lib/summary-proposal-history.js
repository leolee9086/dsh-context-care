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
import { z } from 'zod';
const FORMAT = 'context-care/summary-proposal/v1';
const Evidence = z.object({ format: z.literal(FORMAT), proposalKey: z.string().min(1),
    failureCode: z.string().optional() }).strict();
const NO_USEFUL = new Set(['SUMMARY_NOT_SMALLER', 'SUMMARY_INPUT_BUDGET', 'SUMMARY_EMPTY']);
/**
 * Attach actual proposal identity and an optional actual failure to compaction events.
 * This describes an executed compaction; it is never an independent state snapshot.
 * @param proposalKey - fingerprint of selected material, prices and summary policy.
 * @param failureCode - the summary execution's terminal code, when present.
 * @returns metadata for the real compaction/start or compaction/end append.
 */
export function summaryProposalRecord(proposalKey, failureCode) {
    if (typeof proposalKey !== 'string' || !proposalKey.length)
        return {};
    return { contextCareSummary: { format: FORMAT, proposalKey,
            ...(typeof failureCode === 'string' ? { failureCode } : {}) } };
}
function initial(inheritedEnd) {
    return { cursor: 0, inheritedEnd, pending: new Map(), rejected: new Set() };
}
function apply(state, event) {
    if (event.seq < state.cursor)
        return;
    if (event.seq < state.inheritedEnd || (event.type !== 'compaction/start' && event.type !== 'compaction/end')) {
        state.cursor = event.seq + 1;
        return;
    }
    const metadata = 'contextCareSummary' in event.data ? Evidence.parse(event.data.contextCareSummary) : undefined;
    state.cursor = event.seq + 1;
    if (event.type === 'compaction/start') {
        if (metadata)
            state.pending.set(event.data.compactionId, metadata.proposalKey);
        return;
    }
    const key = state.pending.get(event.data.compactionId);
    state.pending.delete(event.data.compactionId);
    // A lone end, a cancelled attempt or a successful compaction proves no rejection.
    if (metadata && key === metadata.proposalKey && event.data.error !== undefined
        && metadata.failureCode !== undefined && NO_USEFUL.has(metadata.failureCode))
        state.rejected.add(key);
}
/**
 * Reconstruct rejected proposals solely from paired native compaction executions.
 * @param history - the existing native Session query, without Agent activation.
 * @returns incremental live observation and cancellable reads with disposable caches.
 */
export function createSummaryProposalHistory(history, logs) {
    const stateKey = logs.cache.define('summary-proposal-history', 'Native Session identity and committed compaction start/end cursor; status-only growth leaves the result reusable.', session => initial(session.inheritedEventCount));
    const restoring = new WeakMap();
    let closed = false;
    return {
        /** Follow actual commits; cold and mid-install Sessions restore on first read. */
        observe(session, event) {
            if (closed)
                return;
            const active = restoring.get(session);
            if (active) {
                active.events.push(event);
                return;
            }
            const state = logs.cache.peek(session, stateKey)
                ?? (event.seq === 0 ? logs.cache.use(session, stateKey) : undefined);
            // A missed commit requires native replay; never jump its cursor.
            if (state?.cursor !== event.seq)
                return;
            try {
                apply(state, event);
            }
            catch (error) {
                logs.cache.invalidate(session, stateKey);
                throw error;
            }
        },
        /** Read one exact proposal rejection; status-only log growth cannot clear it. */
        async has(session, key, signal) {
            if (closed)
                throw new Error('context-care: summary proposal history closed');
            signal?.throwIfAborted();
            const cached = logs.cache.peek(session, stateKey);
            if (cached?.cursor === session.seq)
                return cached.rejected.has(key);
            let active = restoring.get(session);
            if (!active) {
                const queued = [];
                const task = (async () => {
                    const env_1 = { stack: [], error: void 0, hasError: false };
                    try {
                        const log = await history.readSession(session.id);
                        const lease = __addDisposableResource(env_1, { [Symbol.dispose]: () => log[Symbol.dispose]?.() }, false);
                        if (closed)
                            throw new Error('context-care: summary proposal history closed');
                        const state = cached ?? logs.cache.use(session, stateKey);
                        try {
                            const events = log.select(['compaction/start', 'compaction/end'], state.cursor);
                            for (const event of events)
                                apply(state, event);
                            state.cursor = log.length;
                            for (const event of queued)
                                apply(state, event);
                            logs.cache.worked(stateKey, events.length + queued.length);
                            // Leave restore mode before readers resume so intervening commits
                            // advance this exact projection instead of remaining in the queue.
                            restoring.delete(session);
                            return state;
                        }
                        catch (error) {
                            logs.cache.invalidate(session, stateKey);
                            throw error;
                        }
                    }
                    catch (e_1) {
                        env_1.error = e_1;
                        env_1.hasError = true;
                    }
                    finally {
                        __disposeResources(env_1);
                    }
                })();
                active = { task, events: queued };
                restoring.set(session, active);
                const release = () => { if (restoring.get(session) === active)
                    restoring.delete(session); };
                // Contain this cleanup chain; each has() reader owns the original rejection.
                void task.then(release, release);
            }
            const state = await active.task;
            signal?.throwIfAborted();
            return state.rejected.has(key);
        },
        /** Forget derived proposal state; the next owner reconstructs from the same log. */
        close() { closed = true; logs.cache.clear(stateKey); },
    };
}
//# sourceMappingURL=summary-proposal-history.js.map