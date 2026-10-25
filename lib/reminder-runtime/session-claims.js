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
import { setImmediate as yieldToHost } from 'node:timers/promises';
import { localWindow } from './request-context.js';
import { ensureSessionLog } from '../session-log.js';
import { quotaFor } from './claims.js';
const SharedFact = z.object({ key: z.string(), until: z.number().optional() });
const OwnedMessage = z.object({ id: z.string(), source: z.object({
        kind: z.literal('plugin:dsh-context-care:reminder'),
        reminder: z.object({ key: z.string(), candidateId: z.string(), sessionId: z.string().optional(),
            shared: SharedFact.nullable().optional() }),
        contextCareTrace: z.object({ sourceId: z.string(), ruleId: z.string(), rule: z.unknown(),
            evidence: z.object({ activationId: z.string().optional(),
                event: z.object({ clock: z.object({ at: z.number() }).optional() }).optional(),
                clock: z.object({ at: z.number() }).optional() }).optional() }).optional(),
    }) });
const Owner = z.object({ source: z.object({ kind: z.string() }) });
/**
 * Shared quota is derived from delivered messages and the native pending inbox.
 * Only reservations not yet accepted into that inbox live solely in this cache.
 * @param ctx the owning Host context, including its native Session query service
 * @param now the clock used to discard expired quota windows
 * @returns serialized quota transitions and synchronous committed-event observation
 */
export function createSessionClaims(ctx, now = Date.now) {
    const history = ensureSessionLog(ctx);
    let book = { buckets: [] };
    let ready;
    let lane = Promise.resolve();
    let closed = false;
    let observationFailure;
    const dirty = new Set();
    const chargedActivations = new Set();
    const accepted = new Map();
    const cursorKey = history.cache.define('reminder-shared-claim-cursor', 'Native Session identity and successful shared-claim replay cursor.', () => ({ through: 0 }));
    function record(sessionId, value, status) {
        if (Owner.safeParse(value).data?.source.kind !== 'plugin:dsh-context-care:reminder')
            return;
        const message = OwnedMessage.parse(value), { reminder, contextCareTrace: trace } = message.source;
        let shared = reminder.shared;
        // Old messages already contain their rule and frozen event facts. New messages
        // record the charged identity explicitly, including null for an uncharged tick.
        if (shared === undefined) {
            if (!trace)
                throw new Error('reminder-shared-evidence-missing');
            const rule = trace.rule;
            const model = 'effect' in rule ? rule.effect.deliver.model : rule.deliver.model;
            if (!model.shared)
                return;
            if (trace.evidence?.activationId && chargedActivations.has(trace.evidence.activationId))
                return;
            const clock = trace.evidence?.event?.clock?.at ?? trace.evidence?.clock?.at;
            const window = localWindow(rule.when.timeWindow, clock);
            shared = quotaFor({ sourceId: trace.sourceId, ruleId: trace.ruleId,
                rule: { effect: { deliver: { model } } }, ...(window ? { window } : {}) });
        }
        if (!shared || (shared.until !== undefined && shared.until <= now()))
            return;
        let bucket = book.buckets.find(item => item.key === shared.key);
        if (!bucket) {
            bucket = { key: shared.key, ...(shared.until === undefined ? {} : { until: shared.until }), claims: [] };
            book.buckets.push(bucket);
        }
        const previous = bucket.claims.find(claim => claim.messageId === message.id);
        if (previous) {
            if (status === 'consumed')
                previous.status = status;
        }
        else
            bucket.claims.push({ candidateId: reminder.candidateId, sessionId: reminder.sessionId ?? sessionId,
                messageId: message.id, status });
        chargedActivations.add(reminder.candidateId);
    }
    function readInbox(session, id, canceled = false) {
        const inbox = ctx.get('sessionProjections')?.stateOf(session, 'inbox');
        if (!inbox)
            throw new Error('reminder-shared-inbox-projection-unavailable');
        const messages = [...inbox['next-turn'], ...inbox['next-step']].filter(message => message.source.kind === 'plugin:dsh-context-care:reminder' && message.source.reminder.shared !== null);
        const present = new Set(messages.map(message => String(message.id)));
        if (canceled) {
            const removed = new Set([...(accepted.get(id) ?? [])].filter(messageId => !present.has(messageId)));
            for (const bucket of book.buckets)
                bucket.claims = bucket.claims.filter(claim => claim.status === 'consumed' || !removed.has(claim.messageId));
            book.buckets = book.buckets.filter(bucket => bucket.claims.length > 0);
        }
        for (const message of messages)
            record(id, message, 'reserved');
        if (present.size)
            accepted.set(id, present);
        else
            accepted.delete(id);
    }
    async function readSession(id) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            const log = __addDisposableResource(env_1, await history.read(id), false);
            if (closed)
                throw new Error('reminder-claims-closed');
            let inboxChanged = false;
            let processed = 0;
            const live = ctx.sessions.get(id);
            const cursor = live ? history.cache.use(live, cursorKey) : undefined;
            const fromSeq = cursor?.through ?? 0;
            for (const event of log.select(['user/message', 'agent/inbox/spliced'], fromSeq)) {
                if (event.type === 'user/message')
                    record(String(id), event.data, 'consumed');
                else if (event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === 'plugin:dsh-context-care:reminder' && message.source.reminder.shared !== null))
                    inboxChanged = true;
                // This is a finite corpus fold, not a timer or a repeated read. Yield on
                // progress so a large cold Session cannot monopolize Host HTTP dispatch.
                if (++processed % 2048 === 0) {
                    await yieldToHost();
                    if (closed)
                        throw new Error('reminder-claims-closed');
                }
            }
            // Use the live inbox when available. A dormant log with no reminder insertion
            // cannot own a pending reservation and needs no detached full Session replay.
            if (live && cursor) {
                readInbox(live, String(id));
                cursor.through = log.length;
            }
            else if (inboxChanged)
                readInbox(log.prepare(), String(id));
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }
    async function initialize() {
        // Lifetime quotas need the logical corpus, including dormant sessions; reading
        // only sessions.get/list would silently reset another session's consumption.
        for (const { header } of await history.listSessions()) {
            dirty.delete(header.id);
            await readSession(header.id);
        }
    }
    return {
        /** Observe delivery commits without turning inbox acceptance into consumption. */
        observe(session, event) {
            if (closed)
                return;
            try {
                if (event.type === 'user/message')
                    record(String(session.id), event.data, 'consumed');
                else if (event.type === 'agent/inbox/spliced' && (accepted.has(String(session.id))
                    || event.data.inserted.some(message => message.source.kind === 'plugin:dsh-context-care:reminder'
                        && message.source.reminder.shared !== null))) {
                    // A canceled inbox item releases a reservation. An ordinary claim only
                    // hands it to pre-step: consumption still waits for user/message.
                    readInbox(session, String(session.id), event.data.outcome === 'canceled');
                }
            }
            catch (error) {
                observationFailure = error;
                throw error;
            }
        },
        /** A newly restored Session may contain commits published before this owner existed. */
        created(session) { if (!closed)
            dirty.add(session.id); },
        /** Serialize cross-session reservations; no domain file or ACK participates. */
        update(change) {
            const result = lane.then(async () => {
                if (closed)
                    throw new Error('reminder-claims-closed');
                if (observationFailure)
                    throw observationFailure;
                ready ??= initialize().catch(error => { ready = undefined; throw error; });
                await ready;
                while (dirty.size) {
                    const ids = [...dirty];
                    dirty.clear();
                    for (const id of ids)
                        await readSession(id);
                }
                if (closed)
                    throw new Error('reminder-claims-closed');
                if (observationFailure)
                    throw observationFailure;
                const committed = new Set(book.buckets.flatMap(bucket => bucket.claims
                    .filter(claim => claim.status === 'consumed').map(claim => claim.messageId)));
                const next = change(structuredClone(book));
                for (const bucket of next.buckets)
                    for (const claim of bucket.claims) {
                        if (claim.status === 'consumed' && !committed.has(claim.messageId)) {
                            throw new Error('reminder-shared-delivery-not-committed');
                        }
                    }
                book = next;
                return structuredClone(book);
            });
            lane = result.catch(() => { });
            return result;
        },
        /** Await owned reads and reservations before releasing this disposable cache. */
        async close() {
            closed = true;
            await lane;
            book = { buckets: [] };
            dirty.clear();
            chargedActivations.clear();
            accepted.clear();
            history.cache.clear(cursorKey);
        },
    };
}
//# sourceMappingURL=session-claims.js.map