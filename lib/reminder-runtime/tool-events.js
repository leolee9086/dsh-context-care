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
/** Exclude earlier PTC rejection and cancellations with no proof of a hook observation. */
function unobservedBeforeCalls(events) {
    const skipped = new Set(), names = new Map();
    for (const event of events) {
        if (event.type === 'tool/call')
            names.set(String(event.data.callId), event.data.name);
        else if (event.type === 'tool/result') {
            const id = String(event.data.message.toolCallId), name = names.get(id);
            if (event.data.error?.code === 'ABORTED_BEFORE_DISPATCH' || (name !== undefined && collapsedCall(event, name)))
                skipped.add(id);
            names.delete(id);
        }
        else if (event.type === 'tool/ptc-dispatch' && event.data.error?.code === 'ABORTED_BEFORE_DISPATCH')
            skipped.add(String(event.data.subCallId));
    }
    return skipped;
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
    let calls = new WeakMap();
    let cached = new WeakMap();
    let fullyObserved = new WeakMap();
    let outputThrough = new WeakMap();
    const limit = config.maxQueued + config.maxConcurrent;
    function put(session, id, call) {
        let pending = calls.get(session);
        if (!pending) {
            pending = new Map();
            calls.set(session, pending);
        }
        pending.set(id, call);
    }
    function take(session, id) {
        const pending = calls.get(session), call = pending?.get(id);
        pending?.delete(id);
        if (!pending?.size)
            calls.delete(session);
        return call;
    }
    function remember(session, submission) {
        if (!session)
            return submission;
        let events = cached.get(session);
        if (!events) {
            events = new Map();
            cached.set(session, events);
        }
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
    /** Interpret one native prefix; both explicit resolution and discovery use this path. */
    function fromLog(sessionId, position, events) {
        if (!history)
            throw new Error('reminder-native-tool-history-unavailable');
        const terminal = events[position];
        if (!terminal || terminal.seq !== position
            || (terminal.type !== 'tool/result' && terminal.type !== 'tool/ptc-dispatch')) {
            throw new Error('reminder-native-tool-result-not-found');
        }
        const code = terminal.data.error?.code;
        if (code === 'ABORTED_BEFORE_DISPATCH')
            throw new Error('reminder-native-tool-result-not-dispatched');
        // Native interpretation preserves replacements and content projections at
        // this boundary. A later surface cannot substitute for the historical input.
        const prefix = history.sessions.prepare(undefined, { seed: events.slice(0, terminal.seq) });
        const messages = prefix.deriveMessages();
        if (terminal.type === 'tool/ptc-dispatch') {
            const data = terminal.data;
            return result(config, sessionId, terminal, String(data.subCallId), { name: data.name,
                arguments: data.arguments, rootCallId: String(data.rootCallId) }, data.isError, code, messages);
        }
        const { message } = terminal.data, id = String(message.toolCallId);
        let call;
        for (let index = terminal.seq - 1; index >= 0; index--) {
            const previous = events[index];
            if (previous.type === 'tool/call' && String(previous.data.callId) === id) {
                call = { name: previous.data.name, arguments: argumentsOf(previous.data.arguments), rootCallId: id };
                break;
            }
        }
        if (!call)
            throw new Error('reminder-native-tool-call-not-found');
        return result(config, sessionId, terminal, id, call, message.isError === true, code, messages);
    }
    function outputHistory(sessionId, events) {
        return { id: sessionId, seq: events.length,
            eventAt: seq => events[seq] };
    }
    function* outputSamples(session, terminal) {
        if (!config.output)
            throw new Error('reminder-native-output-config-missing');
        for (const sample of nativeOutputSamples(config.output, session, terminal, error => { throw error; })) {
            yield { event: Event.parse({ ...sample.event, native: { type: 'assistant-output', seq: terminal.seq } }), afterCommit: sample.afterCommit };
        }
    }
    return {
        /** Newly created Sessions have no missed tool history; raw events still depend on rule interest. */
        created(session) { if (session.firstLiveSeq === 0)
            fullyObserved.set(session, '*'); },
        /** Cache the actual native event separately from a tool outcome at the same seq. */
        observeSession(session, event) {
            return remember(session, { event: nativeSessionEvent(String(session.id), event) }).event;
        },
        /** Only an actual logged call can supply a native anchor for the execution hook. */
        preparation(session, callId) {
            const seq = calls.get(session)?.get(callId)?.nativeSeq;
            return seq === undefined ? undefined : { type: 'tool-call', seq };
        },
        /** A paired native call publishes its result after the execution hook. */
        waitForCommit(session, callId) {
            return calls.get(session)?.has(callId) === true;
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
                        cached.get(session)?.delete(`tool-call:${call.nativeSeq}`);
                    }
                    // Mid-call installation remains on the unpaired tools/result path.
                    if (call && error?.code !== 'ABORTED_BEFORE_DISPATCH') {
                        return remember(session, result(config, String(session.id), event, id, call, message.isError === true, error?.code, session.deriveMessages(), String(message.id)));
                    }
                }
                else {
                    const data = event.data, id = String(data.subCallId), call = take(session, id);
                    if (data.error?.code === 'ABORTED_BEFORE_DISPATCH' && call?.nativeSeq !== undefined) {
                        cached.get(session)?.delete(`tool-call:${call.nativeSeq}`);
                    }
                    if (data.error?.code !== 'ABORTED_BEFORE_DISPATCH') {
                        return remember(session, result(config, String(session.id), event, id, { name: data.name,
                            arguments: data.arguments, rootCallId: String(data.rootCallId) }, data.isError, data.error?.code, session.deriveMessages()));
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
            if (!event.native)
                return event;
            signal?.throwIfAborted();
            if (!history)
                throw new Error('reminder-native-tool-history-unavailable');
            const session = history.sessions.get(event.sessionId);
            const hot = session && cached.get(session)?.get(cacheKey(event));
            if (hot)
                return structuredClone(hot);
            if (event.native.type === 'session-event') {
                return remember(session, { event: await resolveNativeSessionEvent(event, history, signal) }).event;
            }
            const log = await history.readSession(event.sessionId);
            signal?.throwIfAborted();
            if (event.native.type === 'assistant-output') {
                const native = log.events[event.native.seq];
                const inherited = log.inheritedEventCount ?? session?.inheritedEventCount;
                if (!native || native.seq !== event.native.seq || inherited === undefined || native.seq < inherited
                    || (native.type !== 'assistant/message' && native.type !== 'assistant/attempt'))
                    throw new Error('reminder-native-output-not-found');
                const view = session && session.seq >= native.seq + 1 ? session : outputHistory(event.sessionId, log.events);
                for (const sample of outputSamples(view, native))
                    if (sample.event.callId === event.callId) {
                        return remember(session, sample).event;
                    }
                throw new Error('reminder-native-output-sample-not-found');
            }
            if (event.native.type === 'tool-call') {
                const native = log.events[event.native.seq];
                const inherited = log.inheritedEventCount ?? session?.inheritedEventCount;
                if (!native || native.seq !== event.native.seq || inherited === undefined || native.seq < inherited) {
                    throw new Error('reminder-native-tool-call-not-found');
                }
                const canonical = beforeCall(event.sessionId, native);
                if (unobservedBeforeCalls(log.events).has(canonical.callId))
                    throw new Error('reminder-native-tool-call-not-dispatched');
                return remember(session, { event: canonical }).event;
            }
            return remember(session, fromLog(event.sessionId, event.native.seq, log.events)).event;
        },
        /** Discover selected local native facts in their original order from one log read. */
        async recover(sessionId, accept, signal, selection = { tools: true, beforeTools: false, outputs: false, sessionEvents: [] }) {
            signal.throwIfAborted();
            if (!history)
                throw new Error('reminder-native-tool-history-unavailable');
            const session = history.sessions.get(sessionId);
            const names = new Set(selection.sessionEvents);
            const signature = JSON.stringify([selection.tools, selection.beforeTools, [...names].sort(), selection.sessionAliases ?? []]);
            const observed = session && fullyObserved.get(session);
            // The tool observer is unconditional. Raw Session events are submitted only
            // while selected rules exist, so an initially empty Session cannot certify
            // a later event-name or alias registration. Its first scan owns that selection.
            const commonObserved = (observed === '*' && names.size === 0) || observed === signature;
            const outputCursor = session && outputThrough.get(session);
            if (commonObserved && (!selection.outputs || (session && outputCursor !== undefined && outputCursor >= session.seq)))
                return;
            let fullEvents;
            let events, through, inherited;
            if (session && commonObserved) {
                // Tool/raw events already have their live observer. Only new committed
                // output needs reconciliation; do not clone or reread the old corpus.
                const live = session;
                through = live.seq;
                inherited = live.inheritedEventCount;
                const start = outputCursor ?? live.firstLiveSeq;
                events = { *[Symbol.iterator]() {
                        for (let cursor = start; cursor < through; cursor++) {
                            const event = live.eventAt(cursor);
                            if (!event)
                                throw new Error('reminder-native-output-event-missing');
                            yield event;
                        }
                    } };
            }
            else {
                const log = await history.readSession(sessionId);
                signal.throwIfAborted();
                fullEvents = log.events;
                events = fullEvents;
                through = fullEvents.length;
                inherited = log.inheritedEventCount ?? session?.inheritedEventCount;
            }
            if (inherited === undefined)
                throw new Error('reminder-native-tool-inheritance-unavailable');
            const outputStart = outputCursor ?? inherited;
            const skipped = selection.beforeTools && fullEvents ? unobservedBeforeCalls(fullEvents) : new Set();
            let outputView = session;
            for (const terminal of events) {
                signal.throwIfAborted();
                // A child inherits readable history, not its parent's local triggers.
                if (terminal.seq < inherited)
                    continue;
                const afterCommit = [];
                if (selection.outputs && terminal.seq >= outputStart && (terminal.type === 'assistant/message' || terminal.type === 'assistant/attempt')) {
                    if (!outputView || outputView.seq < terminal.seq + 1) {
                        if (!fullEvents)
                            throw new Error('reminder-native-output-history-unavailable');
                        outputView = outputHistory(sessionId, fullEvents);
                    }
                    for (const sample of outputSamples(outputView, terminal)) {
                        if (sample.afterCommit)
                            afterCommit.push(sample);
                        else
                            await accept(remember(session, sample).event);
                    }
                }
                // A committed pre-execution reminder may be reconstructed, but a historical
                // denial must never be re-executed as if this tool were about to run again.
                if (!commonObserved && selection.beforeTools && (terminal.type === 'tool/call' || terminal.type === 'tool/ptc-dispatch-start')) {
                    // The committed call event is published before tools/pre-execute runs.
                    if (names.has(terminal.type))
                        await accept(remember(session, { event: nativeSessionEvent(sessionId, terminal) }).event);
                    const before = beforeCall(sessionId, terminal);
                    if (!skipped.has(before.callId))
                        await accept(remember(session, { event: before }).event);
                }
                // Match live publication order: tool outcome first, then its raw Session event.
                if (!commonObserved && fullEvents && selection.tools && (terminal.type === 'tool/result' || terminal.type === 'tool/ptc-dispatch')
                    && terminal.data.error?.code !== 'ABORTED_BEFORE_DISPATCH') {
                    await accept(remember(session, fromLog(sessionId, terminal.seq, fullEvents)).event);
                }
                if (!commonObserved && names.has(terminal.type) && !(selection.beforeTools
                    && (terminal.type === 'tool/call' || terminal.type === 'tool/ptc-dispatch-start'))) {
                    await accept(remember(session, { event: nativeSessionEvent(sessionId, terminal) }).event);
                }
                for (const sample of afterCommit)
                    await accept(remember(session, sample).event);
            }
            signal.throwIfAborted();
            // Only this exact live instance can prove that every later result will be
            // observed. A dormant log may grow elsewhere, and a reloaded Session is a
            // new object. Neither may be skipped just because its id was scanned once.
            if (selection.outputs && session && history.sessions.get(session.id) === session)
                outputThrough.set(session, through);
            if (session && fullEvents && history.sessions.get(session.id) === session && session.seq === through) {
                const pending = new Map();
                for (const event of fullEvents) {
                    if (event.seq < inherited)
                        continue;
                    if (event.type === 'tool/call')
                        pending.set(String(event.data.callId), { nativeSeq: event.seq, name: event.data.name,
                            arguments: argumentsOf(event.data.arguments), rootCallId: String(event.data.callId) });
                    else if (event.type === 'tool/ptc-dispatch-start')
                        pending.set(String(event.data.subCallId), {
                            nativeSeq: event.seq, name: event.data.name, arguments: event.data.arguments, rootCallId: String(event.data.rootCallId)
                        });
                    else if (event.type === 'tool/result')
                        pending.delete(String(event.data.message.toolCallId));
                    else if (event.type === 'tool/ptc-dispatch')
                        pending.delete(String(event.data.subCallId));
                }
                // Calls already pending when the plugin attached must still pair with a
                // future live result; otherwise the completed scan would hide that result.
                calls.set(session, pending);
                fullyObserved.set(session, signature);
            }
        },
        /** Release process-local pairing and context caches without changing any log. */
        close() { calls = new WeakMap(); cached = new WeakMap(); fullyObserved = new WeakMap(); outputThrough = new WeakMap(); },
    };
}
//# sourceMappingURL=tool-events.js.map