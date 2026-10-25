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
/**
 * Read only the current surface tail through native message projections. One
 * extra message preserves requestContext's truncation indicator without copying
 * the complete derived transcript. The current result may be excluded by ID.
 */
export function sessionMessageTail(session, maxMessages, excludeMessageId) {
    const messages = [];
    const nodes = session.surface.nodes;
    for (let index = nodes.length - 1; index >= 0 && messages.length <= maxMessages; index--) {
        const event = session.eventAt(nodes[index]);
        if (!event)
            throw new Error('context-care-session-surface-event-missing');
        const message = session.deriveEventMessage(event);
        if (message && message.id !== excludeMessageId)
            messages.unshift(message);
    }
    return messages;
}
/** Host-owned access to native immutable logs; no reminder or delivery state lives here. */
export function createSessionLog(ctx) {
    const surfaces = new WeakMap();
    const histories = new WeakMap();
    const messageKey = {};
    const liveIndexes = new WeakMap();
    const coldIndexes = new WeakMap();
    const pending = new Map();
    let closed = false;
    function indexFor(map, key) {
        let index = map.get(key);
        if (!index) {
            index = { ranges: [], events: new Map(), byType: new Map(), latest: new Map() };
            map.set(key, index);
        }
        return index;
    }
    function view(header, inheritedEventCount, length, at, snapshot, index, prepare, release) {
        let disposed = false;
        let fullSnapshot;
        const active = () => { if (closed || disposed)
            throw new Error('context-care-session-log-closed'); };
        const complete = () => {
            active();
            if (fullSnapshot)
                return fullSnapshot;
            // Only compatibility consumers need the complete array. Share that array
            // at the same immutable cut, without retaining every historical cut.
            fullSnapshot = index.snapshot?.length === length ? index.snapshot.events : snapshot();
            if (!index.snapshot || index.snapshot.length <= length)
                index.snapshot = { length, events: fullSnapshot };
            return fullSnapshot;
        };
        const get = (seq) => {
            active();
            if (seq < 0 || seq >= length)
                return undefined;
            let event = index.events.get(seq);
            if (!event) {
                event = at(seq);
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
        return { header, inheritedEventCount, length,
            get events() { return complete(); }, at: get, range,
            last(type, beforeSeq = length) {
                active();
                const end = Math.min(length, beforeSeq), cached = index.latest.get(type);
                if (cached && cached.through >= end && (!cached.event || cached.event.seq < end))
                    return cached.event;
                const floor = cached && cached.through <= end ? cached.through : 0;
                const covering = index.ranges.find(span => span.from <= floor && span.end >= end);
                if (covering) {
                    const events = index.byType.get(type) ?? [], position = lowerBound(events, end) - 1;
                    const indexed = position >= 0 ? events[position] : undefined;
                    const previous = cached && cached.through <= end ? cached.event : undefined;
                    const event = previous && (!indexed || previous.seq > indexed.seq) ? previous : indexed;
                    if (end === length)
                        index.latest.set(type, { through: end, event });
                    return event;
                }
                for (let seq = end - 1; seq >= floor; seq--) {
                    const event = get(seq);
                    if (event?.type !== type)
                        continue;
                    if (end === length)
                        index.latest.set(type, { through: end, event });
                    return event;
                }
                const event = cached && cached.through <= end ? cached.event : undefined;
                if (end === length)
                    index.latest.set(type, { through: end, event });
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
        return view(session.header, session.inheritedEventCount, length, seq => session.eventAt(seq), () => session.snapshotEvents(undefined, length), indexFor(liveIndexes, session), () => session, () => { });
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
            return view(observation.header, observation.inheritedEventCount, observation.cursor + 1, seq => events[seq], () => events, indexFor(coldIndexes, events), () => ctx.sessions.prepare(id, { seed: [...events], meta: observation.header,
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
        let state = surfaces.get(session);
        if (!state) {
            state = { generation, through: 0, logThrough: 0, entries: [], chronological: [], projections: new Map() };
            surfaces.set(session, state);
        }
        const replaced = state.generation !== generation;
        if (replaced) {
            state.generation = generation;
            state.through = 0;
            state.entries = [];
            state.chronological = [];
        }
        if (state.through !== nodes.length) {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const log = __addDisposableResource(env_1, live(session)
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
                }
                if (replaced || state.through === 0)
                    state.chronological.sort((a, b) => a.event.seq - b.event.seq);
                state.through = nodes.length;
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        }
        return state;
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
        // A consumer key is owned by one projection function and one result type.
        return (cached.snapshot ??= cached.values.slice());
    }
    function messageOrigins(session) {
        return projectSurface(session, messageKey, entry => {
            const message = session.deriveEventMessage(entry.event);
            return message ? [{ ...entry, message }] : [];
        }, true);
    }
    function origins(session) {
        const messages = messageOrigins(session), state = surfaceState(session);
        if (state.origins?.messages !== messages) {
            const byId = new Map();
            let system;
            for (const value of messages) {
                const id = String(value.message.id), prior = byId.get(id);
                if (!prior || prior.event.seq < value.event.seq)
                    byId.set(id, value);
                if (value.message.role === 'system' && (!system || value.event.seq < system.event.seq))
                    system = value;
            }
            state.origins = { messages, byId, system };
        }
        return state.origins;
    }
    function projectHistory(session, key, types, project, beforeSeq = session.seq) {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            const log = __addDisposableResource(env_2, live(session), false);
            let consumers = histories.get(session);
            if (!consumers) {
                consumers = new Map();
                histories.set(session, consumers);
            }
            let state = consumers.get(key);
            if (!state) {
                state = { through: 0, turnId: String(session.id) + ':seed', values: [], ends: [] };
                consumers.set(key, state);
            }
            const end = Math.min(beforeSeq, log.length);
            if (state.through < end) {
                const selected = new Set(types);
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
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
    return { read, live, projectSurface, projectHistory, origins,
        messages(session) {
            const projected = messageOrigins(session), state = surfaceState(session);
            if (state.messages?.origins !== projected)
                state.messages = { origins: projected, values: projected.map(value => value.message) };
            return state.messages.values;
        },
        withLive(session, reader) { const env_3 = { stack: [], error: void 0, hasError: false }; try {
            const log = __addDisposableResource(env_3, live(session), false);
            return reader(log);
        }
        catch (e_3) {
            env_3.error = e_3;
            env_3.hasError = true;
        }
        finally {
            __disposeResources(env_3);
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