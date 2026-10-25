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
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToHost } from 'node:timers/promises';
import { createSessionCache } from './session-cache.js';
/** Host-owned access to native immutable logs; no reminder or delivery state lives here. */
export function createSessionLog(ctx) {
    const cache = createSessionCache(), messageKey = {};
    const emptyIndex = () => ({ ranges: [], events: new Map(), byType: new Map(), latest: new Map() });
    const sessionKey = { name: 'session-log',
        validity: 'Exact native Session identity; append cursors, replacement and content generations are tracked within its projections.',
        create: () => ({ index: emptyIndex(), histories: new Map() }) };
    const coldKey = { name: 'cold-log',
        validity: 'Immutable observation array identity after native persistence revision validation.', create: emptyIndex };
    const owned = (session) => cache.use(session, sessionKey);
    const pending = new Map();
    let closed = false;
    const stopDisposed = ctx.on('session/disposed', session => cache.release(session));
    function view(header, inheritedEventCount, length, at, snapshot, index, owner, prepare, release) {
        let disposed = false;
        let fullSnapshot;
        const active = () => { if (closed || disposed)
            throw new Error('context-care-session-log-closed'); };
        const complete = async (signal) => {
            active();
            signal?.throwIfAborted();
            if (!fullSnapshot) {
                const task = index.snapshot?.length === length ? index.snapshot.events : snapshot();
                fullSnapshot = task;
                if (!index.snapshot || index.snapshot.length <= length)
                    index.snapshot = { length, events: task };
                // Failed reads must not poison later attempts at the same cut.
                void task.catch(() => {
                    if (fullSnapshot === task)
                        fullSnapshot = undefined;
                    if (index.snapshot?.events === task)
                        index.snapshot = undefined;
                });
            }
            let abort;
            try {
                const events = signal ? await Promise.race([fullSnapshot, new Promise((_, reject) => {
                        abort = () => reject(signal.reason);
                        signal.addEventListener('abort', abort, { once: true });
                        if (signal.aborted)
                            abort();
                    })]) : await fullSnapshot;
                active();
                signal?.throwIfAborted();
                if (!index.accepted || index.accepted.length < events.length)
                    index.accepted = events;
                return events;
            }
            finally {
                if (abort)
                    signal?.removeEventListener('abort', abort);
            }
        };
        const get = (seq) => {
            active();
            if (seq < 0 || seq >= length)
                return undefined;
            let event = index.events.get(seq);
            if (!event) {
                event = index.accepted?.[seq] ?? at(seq);
                if (!event)
                    throw new Error(`context-care-session-log-event-missing: ${header.id}:${seq}`);
                index.events.set(seq, event);
            }
            return event;
        };
        const lowerBound = (events, seq) => {
            let left = 0, right = events.length;
            while (left < right) {
                const middle = Math.floor((left + right) / 2);
                if (events[middle].seq < seq)
                    left = middle + 1;
                else
                    right = middle;
            }
            return left;
        };
        function* range(fromSeq, toSeqExclusive = length) {
            for (let seq = Math.max(0, fromSeq); seq < Math.min(length, toSeqExclusive); seq++) {
                const event = get(seq);
                if (!event)
                    throw new Error(`context-care-session-log-event-missing: ${header.id}:${seq}`);
                yield event;
            }
        }
        return { header, inheritedEventCount, owner, length,
            all: complete, at: get, range,
            last(type, beforeSeq = length) {
                active();
                const types = typeof type === 'string' ? [type] : [...new Set(type)].sort();
                const key = types.join('|'), end = Math.min(length, beforeSeq), cached = index.latest.get(key);
                if (cached && cached.through >= end && (!cached.event || cached.event.seq < end))
                    return cached.event;
                const floor = cached && cached.through <= end ? cached.through : 0;
                const covering = index.ranges.find(span => span.from <= floor && span.end >= end);
                if (covering) {
                    let event = cached && cached.through <= end ? cached.event : undefined;
                    for (const kind of types) {
                        const events = index.byType.get(kind) ?? [], position = lowerBound(events, end) - 1;
                        const indexed = position >= 0 ? events[position] : undefined;
                        if (indexed && (!event || indexed.seq > event.seq))
                            event = indexed;
                    }
                    if (end === length)
                        index.latest.set(key, { through: end, event });
                    return event;
                }
                for (let seq = end - 1; seq >= floor; seq--) {
                    const event = get(seq);
                    if (!event || !types.includes(event.type))
                        continue;
                    if (end === length)
                        index.latest.set(key, { through: end, event });
                    return event;
                }
                const event = cached && cached.through <= end ? cached.event : undefined;
                if (end === length)
                    index.latest.set(key, { through: end, event });
                return event;
            },
            select(types, fromSeq = 0, toSeqExclusive = length) {
                active();
                const from = Math.max(0, fromSeq), end = Math.min(length, toSeqExclusive);
                if (from >= end)
                    return [];
                // Each consumer asks for its own interval. Index only uncovered gaps; a
                // tail receipt query must never force reading the unrelated old prefix.
                const additions = new Map();
                const scan = (start, stop) => {
                    for (const event of range(start, stop)) {
                        let list = additions.get(event.type);
                        if (!list) {
                            list = [];
                            additions.set(event.type, list);
                        }
                        list.push(event);
                    }
                };
                let cursor = from;
                for (const covered of index.ranges) {
                    if (covered.end <= cursor)
                        continue;
                    if (covered.from >= end)
                        break;
                    if (covered.from > cursor)
                        scan(cursor, covered.from);
                    cursor = Math.max(cursor, covered.end);
                    if (cursor >= end)
                        break;
                }
                if (cursor < end)
                    scan(cursor, end);
                for (const [type, added] of additions) {
                    const previous = index.byType.get(type);
                    if (!previous)
                        index.byType.set(type, added);
                    else if (previous[previous.length - 1].seq < added[0].seq) {
                        for (const event of added)
                            previous.push(event);
                    }
                    else
                        index.byType.set(type, previous.concat(added).sort((a, b) => a.seq - b.seq));
                }
                const merged = [];
                for (const span of [...index.ranges, { from, end }].sort((a, b) => a.from - b.from)) {
                    const previous = merged[merged.length - 1];
                    if (previous && span.from <= previous.end)
                        previous.end = Math.max(previous.end, span.end);
                    else
                        merged.push({ ...span });
                }
                index.ranges = merged;
                return [...new Set(types)].flatMap(type => {
                    const events = index.byType.get(type) ?? [];
                    return events.slice(lowerBound(events, from), lowerBound(events, end));
                }).sort((a, b) => a.seq - b.seq);
            },
            prepare() { active(); return index.prepared ??= prepare(); },
            [Symbol.dispose]() { if (!disposed) {
                disposed = true;
                release();
            } }, };
    }
    function live(session) {
        if (closed)
            throw new Error('context-care-session-log-closed');
        const length = session.seq;
        return view(session.header, session.inheritedEventCount, length, seq => session.eventAt(seq), async () => {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const query = ctx.get('sessionQuery');
                if (!query)
                    throw new Error('context-care-session-history-unavailable');
                if (ctx.sessions.get(session.id) !== session)
                    throw new Error('context-care-session-history-detached');
                const observation = __addDisposableResource(env_1, await query.observeSession(session.id, { projectionMode: 'none' }), false);
                if (observation.source !== 'live' || observation.header !== session.header || observation.cursor + 1 < length) {
                    throw new Error('context-care-session-history-cut-changed');
                }
                const events = observation.events;
                return events.length === length ? events : Object.freeze(events.slice(0, length));
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        }, owned(session).index, session, () => session, () => { });
    }
    function historical(session, beforeSeq) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            if (closed)
                throw new Error('context-care-session-log-closed');
            if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 0 || beforeSeq > session.seq)
                throw new Error('context-care-session-history-cut-invalid');
            const state = owned(session), cached = state.historical;
            if (cached?.before === beforeSeq) {
                // Native projection interpreters can be disposed without a log append.
                void cached.session.surface.contentGeneration;
                return cached.session;
            }
            const log = __addDisposableResource(env_2, live(session), false);
            const seed = [...log.range(0, beforeSeq)];
            const id = `context-care-history-${randomUUID()}`;
            const prepared = ctx.sessions.prepare(id, { seed, meta: { ...session.header, id },
                inheritedEventCount: Math.min(session.inheritedEventCount, beforeSeq), eventState: 'shared-frozen' });
            const index = owned(prepared).index;
            index.ranges = [{ from: 0, end: beforeSeq }];
            for (const event of seed) {
                index.events.set(event.seq, event);
                let bucket = index.byType.get(event.type);
                if (!bucket) {
                    bucket = [];
                    index.byType.set(event.type, bucket);
                }
                bucket.push(event);
            }
            state.historical = { before: beforeSeq, session: prepared };
            return prepared;
        }
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
    function release(id, entry) {
        entry.readers--;
        if (entry.readers !== 0)
            return;
        if (pending.get(id) === entry)
            pending.delete(id);
        if (entry.observation)
            entry.observation[Symbol.dispose]();
        else
            entry.controller.abort(new Error('context-care-session-log-no-readers'));
    }
    async function read(id, signal) {
        signal?.throwIfAborted();
        if (closed)
            throw new Error('context-care-session-log-closed');
        const session = ctx.sessions.get(id);
        if (session)
            return live(session);
        let entry = pending.get(id);
        if (!entry) {
            const query = ctx.get('sessionQuery');
            if (!query)
                throw new Error('context-care-session-history-unavailable');
            const controller = new AbortController();
            const task = query.observeSession(id, { projectionMode: 'none', signal: controller.signal });
            entry = { task, controller, readers: 0 };
            pending.set(id, entry);
            const owner = entry;
            // The native reader owns revision checking and its bounded cold cache.
            // This module merges simultaneous consumers, not indefinitely stale cuts.
            void task.then(observation => {
                owner.observation = observation;
                if (pending.get(id) === owner)
                    pending.delete(id);
                if (owner.readers === 0)
                    observation[Symbol.dispose]();
            }, () => { if (pending.get(id) === owner)
                pending.delete(id); });
        }
        const owner = entry;
        owner.readers++;
        let abort;
        try {
            const observation = signal ? await Promise.race([owner.task, new Promise((_, reject) => {
                    abort = () => reject(signal.reason);
                    signal.addEventListener('abort', abort, { once: true });
                    if (signal.aborted)
                        abort();
                })]) : await owner.task;
            signal?.throwIfAborted();
            if (closed)
                throw new Error('context-care-session-log-closed');
            const attached = ctx.sessions.get(id);
            if (attached) {
                release(id, owner);
                return live(attached);
            }
            const events = observation.events;
            return view(observation.header, observation.inheritedEventCount, observation.cursor + 1, seq => events[seq], async () => events, cache.use(events, coldKey), events, () => ctx.sessions.prepare(id, { seed: [...events], meta: observation.header,
                inheritedEventCount: observation.inheritedEventCount, eventState: 'shared-frozen' }), () => release(id, owner));
        }
        catch (error) {
            release(id, owner);
            throw error;
        }
        finally {
            if (abort)
                signal?.removeEventListener('abort', abort);
        }
    }
    function surfaceState(session) {
        if (closed)
            throw new Error('context-care-session-log-closed');
        const nodes = session.surface.nodes, generation = session.surface.replaceGeneration;
        const owner = owned(session);
        const state = owner.surface ??= { generation, through: 0, logThrough: 0, entries: [], chronological: [], byType: new Map(), projections: new Map() };
        const replaced = state.generation !== generation;
        if (replaced) {
            state.generation = generation;
            state.through = 0;
            state.entries = [];
            state.chronological = [];
            state.byType.clear();
        }
        if (state.through !== nodes.length) {
            const env_3 = { stack: [], error: void 0, hasError: false };
            try {
                const log = __addDisposableResource(env_3, live(session)
                // Build the shared type index only for new log positions. last() can then
                // assign each surface entry its turn by indexed lookup instead of a scan.
                , false);
                // Build the shared type index only for new log positions. last() can then
                // assign each surface entry its turn by indexed lookup instead of a scan.
                log.select(['turn/start'], state.logThrough);
                state.logThrough = log.length;
                for (let index = state.through; index < nodes.length; index++) {
                    const event = log.at(nodes[index]);
                    if (!event)
                        throw new Error('context-care-session-surface-event-missing');
                    const turn = log.last('turn/start', event.seq + 1);
                    const turnId = turn?.type === 'turn/start'
                        ? String(session.id) + ':turn:' + (turn.data.turn ?? turn.seq) : String(session.id) + ':seed';
                    const entry = { event, turnId };
                    state.entries.push(entry);
                    state.chronological.push(entry);
                    let bucket = state.byType.get(event.type);
                    if (!bucket) {
                        bucket = { values: [] };
                        state.byType.set(event.type, bucket);
                    }
                    bucket.values.push(event);
                    bucket.snapshot = undefined;
                }
                if (replaced || state.through === 0)
                    state.chronological.sort((a, b) => a.event.seq - b.event.seq);
                state.through = nodes.length;
            }
            catch (e_3) {
                env_3.error = e_3;
                env_3.hasError = true;
            }
            finally {
                __disposeResources(env_3);
            }
        }
        return state;
    }
    const noSurfaceEvents = { length: 0, at: () => undefined, slice: () => [] };
    function surfaceEvents(session, type) {
        const bucket = surfaceState(session).byType.get(type);
        if (!bucket)
            return noSurfaceEvents;
        if (!bucket.snapshot) {
            const values = bucket.values, length = values.length;
            bucket.snapshot = { length, at: index => index >= 0 && index < length ? values[index] : undefined,
                slice: (from = 0, to = length) => values.slice(Math.max(0, from), Math.min(length, to)) };
        }
        return bucket.snapshot;
    }
    function lastSurface(session, type) {
        return surfaceState(session).byType.get(type)?.values.at(-1);
    }
    function projectSurface(session, key, project, projected = false) {
        const state = surfaceState(session);
        const generation = projected ? session.surface.contentGeneration : -1;
        const entries = projected ? state.entries : state.chronological;
        let cached = state.projections.get(key);
        if (!cached || cached.generation !== generation) {
            cached = { generation, through: 0, entries, values: [], byEvent: new WeakMap() };
            state.projections.set(key, cached);
        }
        // A replacement changes positions, not immutable original-event blocks.
        // The entries array identity distinguishes a rebuild from pure tail growth.
        if (cached.entries !== entries) {
            cached.entries = entries;
            cached.values = [];
            cached.through = 0;
            cached.snapshot = undefined;
        }
        try {
            for (let index = cached.through; index < entries.length; index++) {
                const entry = entries[index];
                let values = cached.byEvent.get(entry.event);
                if (!values) {
                    values = project(entry);
                    cached.byEvent.set(entry.event, values);
                }
                for (const value of values)
                    cached.values.push(value);
                cached.through = index + 1;
                cached.snapshot = undefined;
            }
        }
        catch (error) {
            state.projections.delete(key);
            throw error;
        }
        // A consumer key is owned by one projection function and one result type.
        return (cached.snapshot ??= cached.values.slice());
    }
    const emptyPrefix = () => ({ events: [], nodes: [], messages: new Map(), calls: new Map(), used: new Set(), lane: Promise.resolve() });
    const prefixKey = cache.define('native-historical-context', 'Immutable log owner; native projection definitions and incremental event cursor before an explicit terminal.', emptyPrefix);
    async function contextBefore(log, terminal, maxMessages, signal) {
        signal?.throwIfAborted();
        const root = cache.use(log.owner, prefixKey);
        const task = root.lane.then(async () => {
            signal?.throwIfAborted();
            if (closed)
                throw new Error('context-care-session-log-closed');
            if (cache.peek(log.owner, prefixKey) !== root)
                return contextBefore(log, terminal, maxMessages, signal);
            if (log.at(terminal.seq) !== terminal)
                throw new Error('context-care-session-history-terminal-mismatch');
            // One backward reader must not discard the forward recovery cursor. Retain
            // only its latest older fold, not a full prefix per historical terminal.
            let state = root;
            if (terminal.seq < root.events.length) {
                if (!root.older || root.older.events.length > terminal.seq)
                    root.older = emptyPrefix();
                state = root.older;
            }
            const definitions = ctx.sessions.messageProjections;
            const assertDefinitions = () => {
                for (const definition of state.used)
                    if (!definitions.includes(definition)) {
                        throw new Error(`context-care-native-message-projection-unloaded: ${definition.type}`);
                    }
            };
            const byType = new Map(definitions.map(definition => [definition.type, definition]));
            try {
                assertDefinitions();
                while (state.events.length < terminal.seq) {
                    signal?.throwIfAborted();
                    const event = log.at(state.events.length);
                    if (!event)
                        throw new Error('context-care-session-history-prefix-missing');
                    const definition = byType.get(event.type);
                    if (definition) {
                        const updates = definition.project(event, { nodes: state.nodes, events: state.events,
                            baseSeq: 0, messages: state.messages });
                        for (const [seq, message] of updates)
                            state.messages.set(seq, message);
                        state.used.add(definition);
                    }
                    else if (event.surfaceOp === 'append')
                        state.nodes.push(event.seq);
                    else if (event.surfaceOp && typeof event.surfaceOp === 'object' && 'op' in event.surfaceOp && event.surfaceOp.op === 'replace') {
                        const start = state.nodes.indexOf(event.surfaceOp.startSeq), end = state.nodes.indexOf(event.surfaceOp.endSeq);
                        if (start < 0 || end < start)
                            throw new Error('context-care-native-surface-range-missing');
                        state.nodes.splice(start, end - start + 1, event.seq);
                    }
                    state.events.push(event);
                    if (event.type === 'tool/call')
                        state.calls.set(String(event.data.callId), event);
                    cache.worked(prefixKey);
                    if (state.events.length % 2048 === 0) {
                        await yieldToHost();
                        signal?.throwIfAborted();
                        assertDefinitions();
                        if (closed)
                            throw new Error('context-care-session-log-closed');
                    }
                }
                const messages = [];
                for (let index = state.nodes.length - 1; index >= 0 && messages.length <= maxMessages; index--) {
                    const seq = state.nodes[index];
                    let message = state.messages.get(seq);
                    if (!message) {
                        state.native ??= ctx.sessions.prepare();
                        message = state.native.deriveEventMessage(state.events[seq]) ?? undefined;
                        if (message)
                            state.messages.set(seq, message);
                    }
                    if (message)
                        messages.unshift(message);
                }
                const call = terminal.type === 'tool/result' ? state.calls.get(String(terminal.data.message.toolCallId)) : undefined;
                return { messages, ...(call ? { call } : {}) };
            }
            catch (error) {
                // A failed native interpreter may have mutated nodes before throwing.
                if (cache.peek(log.owner, prefixKey) === root)
                    cache.invalidate(log.owner, prefixKey);
                throw error;
            }
        });
        // The returned task owns the failure; subsequent readers still get a turn.
        root.lane = task.catch(() => undefined);
        return task;
    }
    function derivedMessage(session, event) {
        const generation = session.surface.contentGeneration, state = owned(session);
        if (state.messages?.generation !== generation)
            state.messages = { generation, values: new Map() };
        const values = state.messages.values;
        if (!values.has(event.seq))
            values.set(event.seq, session.deriveEventMessage(event) ?? undefined);
        return values.get(event.seq);
    }
    function messageAt(session, seq) {
        const env_4 = { stack: [], error: void 0, hasError: false };
        try {
            const log = __addDisposableResource(env_4, live(session), false);
            const event = log.at(seq);
            return event ? derivedMessage(session, event) : undefined;
        }
        catch (e_4) {
            env_4.error = e_4;
            env_4.hasError = true;
        }
        finally {
            __disposeResources(env_4);
        }
    }
    function tail(session, maxMessages, excludeMessageId) {
        const env_5 = { stack: [], error: void 0, hasError: false };
        try {
            const messages = [], nodes = session.surface.nodes;
            const log = __addDisposableResource(env_5, live(session), false);
            for (let index = nodes.length - 1; index >= 0 && messages.length <= maxMessages; index--) {
                const event = log.at(nodes[index]);
                if (!event)
                    throw new Error('context-care-session-surface-event-missing');
                const message = derivedMessage(session, event);
                if (message && message.id !== excludeMessageId)
                    messages.unshift(message);
            }
            return messages;
        }
        catch (e_5) {
            env_5.error = e_5;
            env_5.hasError = true;
        }
        finally {
            __disposeResources(env_5);
        }
    }
    function messageOrigins(session) {
        return projectSurface(session, messageKey, entry => {
            const message = derivedMessage(session, entry.event);
            return message ? [{ ...entry, message }] : [];
        }, true);
    }
    function tools(session) {
        const state = owned(session);
        if (state.tools?.through !== session.seq)
            state.tools = { through: session.seq, value: session.toolHistory() };
        return state.tools.value;
    }
    function origins(session) {
        const messages = messageOrigins(session), state = surfaceState(session);
        let indexed = state.origins;
        if (!indexed || indexed.through > messages.length
            || indexed.through > 0 && messages[indexed.through - 1] !== indexed.last) {
            indexed = { through: 0, byId: new Map() };
            state.origins = indexed;
        }
        if (indexed.snapshot?.messages === messages)
            return indexed.snapshot;
        for (let index = indexed.through; index < messages.length; index++) {
            const value = messages[index], id = String(value.message.id);
            let bucket = indexed.byId.get(id);
            if (!bucket) {
                bucket = [];
                indexed.byId.set(id, bucket);
            }
            const prior = bucket.at(-1)?.value;
            // Duplicate message ids keep the newest native origin in this surface cut.
            bucket.push({ index, value: prior && prior.event.seq >= value.event.seq ? prior : value });
            if (value.message.role === 'system' && (!indexed.system || value.event.seq < indexed.system.event.seq))
                indexed.system = value;
            cache.worked(sessionKey);
        }
        indexed.through = messages.length;
        indexed.last = messages.at(-1);
        const length = messages.length, directory = indexed.byId;
        indexed.snapshot = { messages, system: indexed.system, byId: { get(id) {
                    const bucket = directory.get(id);
                    if (!bucket)
                        return undefined;
                    let left = 0, right = bucket.length;
                    while (left < right) {
                        const middle = Math.floor((left + right) / 2);
                        if (bucket[middle].index < length)
                            left = middle + 1;
                        else
                            right = middle;
                    }
                    return left > 0 ? bucket[left - 1].value : undefined;
                } } };
        return indexed.snapshot;
    }
    function projectHistory(session, key, types, project, beforeSeq = session.seq) {
        const env_6 = { stack: [], error: void 0, hasError: false };
        try {
            const log = __addDisposableResource(env_6, live(session), false);
            const consumers = owned(session).histories;
            let state = consumers.get(key);
            if (!state) {
                state = { through: 0, turnId: String(session.id) + ':seed', values: [], ends: [] };
                consumers.set(key, state);
            }
            const end = Math.min(beforeSeq, log.length);
            if (state.through < end) {
                const selected = new Set(types);
                try {
                    for (const event of log.select([...types, 'turn/start'], state.through, end)) {
                        if (event.type === 'turn/start')
                            state.turnId = String(session.id) + ':turn:' + (event.data.turn ?? event.seq);
                        if (!selected.has(event.type))
                            continue;
                        for (const value of project({ event, turnId: state.turnId }))
                            state.values.push(value);
                        state.ends.push({ seq: event.seq, end: state.values.length });
                        state.through = event.seq + 1;
                    }
                    state.through = end;
                }
                catch (error) {
                    // A callback or iterator may fail after appending values. The next read
                    // must reconstruct this consumer, never resume a half-published event.
                    consumers.delete(key);
                    throw error;
                }
            }
            let left = 0, right = state.ends.length;
            while (left < right) {
                const middle = Math.floor((left + right) / 2);
                if (state.ends[middle].seq < end)
                    left = middle + 1;
                else
                    right = middle;
            }
            const length = left ? state.ends[left - 1].end : 0;
            const values = state.values;
            return { length, at: index => index >= 0 && index < length ? values[index] : undefined,
                slice: (from = 0, to = length) => values.slice(Math.max(0, from), Math.min(length, to)) };
        }
        catch (e_6) {
            env_6.error = e_6;
            env_6.hasError = true;
        }
        finally {
            __disposeResources(env_6);
        }
    }
    return { cache, read, live, surfaceEvents, lastSurface, historical, projectSurface, projectHistory, origins, messageAt, tail, contextBefore, tools,
        messages(session) {
            const projected = messageOrigins(session), state = surfaceState(session);
            if (state.messages?.origins !== projected)
                state.messages = { origins: projected, values: projected.map(value => value.message) };
            return state.messages.values;
        },
        withLive(session, reader) { const env_7 = { stack: [], error: void 0, hasError: false }; try {
            const log = __addDisposableResource(env_7, live(session), false);
            return reader(log);
        }
        catch (e_7) {
            env_7.error = e_7;
            env_7.hasError = true;
        }
        finally {
            __disposeResources(env_7);
        } },
        async listSessions(signal) {
            if (closed)
                throw new Error('context-care-session-log-closed');
            const query = ctx.get('sessionQuery');
            if (!query)
                throw new Error('context-care-session-history-unavailable');
            return query.listSessions(signal);
        },
        close() {
            if (closed)
                return;
            closed = true;
            for (const entry of pending.values())
                entry.controller.abort(new Error('context-care-session-log-closed'));
            // Existing leases release their observations exactly once when readers exit.
            pending.clear();
            stopDisposed();
            cache.close();
        }, };
}
/** One service per Host composition, shared by requests, reminders and diagnostics. */
export function ensureSessionLog(ctx) {
    // The synchronous service is usable during its owner's async initialization.
    const current = ctx.get('contextCareSessionLog', false);
    if (current)
        return current;
    const log = createSessionLog(ctx);
    ctx.provide('contextCareSessionLog', log);
    ctx.effect(() => () => log.close());
    return log;
}
//# sourceMappingURL=session-log.js.map