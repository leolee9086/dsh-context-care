/**
 * Read current recipient identity from native Session facts and Host registries.
 * A persisted Session stays detached; resolving it never creates an Agent.
 * @param ctx - owner of the native query, projection and preset services.
 * @returns a cancellable identity reader for live or persisted Sessions.
 */
export function createSessionIdentityResolver(ctx) {
    // This fallback is needed only when the Host omits the preset projection.
    // A selected event updates the cache even while a document read is in flight.
    const selections = new WeakMap();
    ctx.on('session/created', session => {
        if (session.firstLiveSeq === 0)
            selections.set(session, { value: session.header.agentPreset });
    });
    ctx.on('session/event', (session, event) => {
        if (event.type === 'agent-preset/selected')
            selections.set(session, { value: event.data.agentPreset ?? undefined });
    });
    async function readLog(id, signal) {
        signal?.throwIfAborted();
        const query = ctx.get('sessionQuery');
        if (!query)
            throw new Error(`reminder-session-history-unavailable: ${id}`);
        const log = await query.readSession(id);
        signal?.throwIfAborted();
        return log;
    }
    async function currentPreset(session, events, signal) {
        const projected = ctx.get('sessionProjections')?.stateOf(session, 'agentPreset');
        if (projected !== undefined)
            return projected ?? undefined;
        const cached = selections.get(session);
        if (cached)
            return cached.value;
        const log = events ?? (await readLog(session.id, signal)).events;
        const concurrent = selections.get(session);
        if (concurrent)
            return concurrent.value;
        let value = session.header.agentPreset;
        for (let index = log.length - 1; index >= 0; index--) {
            const event = log[index];
            if (event.type === 'agent-preset/selected') {
                value = event.data.agentPreset ?? undefined;
                break;
            }
        }
        selections.set(session, { value });
        return value;
    }
    return async (id, signal) => {
        const nativeId = id;
        let session = ctx.sessions.get(nativeId), events;
        if (!session) {
            const log = await readLog(nativeId, signal);
            // Prefer a Session attached while the native query was pending.
            session = ctx.sessions.get(nativeId) ?? ctx.sessions.prepare(nativeId, { seed: log.events,
                meta: log.session, inheritedEventCount: log.inheritedEventCount, eventState: 'detached' });
            events = log.events;
        }
        const projections = ctx.get('sessionProjections'), presets = ctx.get('agentPresets');
        for (;;) {
            signal?.throwIfAborted();
            const agentPreset = await currentPreset(session, events, signal);
            const document = agentPreset === undefined ? undefined : await presets?.readDocument(agentPreset);
            signal?.throwIfAborted();
            const live = ctx.sessions.get(nativeId);
            if (live && live !== session) {
                session = live;
                events = undefined;
                continue;
            }
            if (await currentPreset(session, events, signal) !== agentPreset)
                continue;
            const agent = ctx.get('agents')?.get(nativeId);
            const defaults = agent ? presets?.serviceFor(agent, 'agentDefaultModel') : ctx.get('agentDefaultModel');
            const selection = projections?.stateOf(session, 'modelSelection')?.pending
                ?? session.requestHeader()?.config ?? defaults?.currentSelection();
            return { ...(agentPreset === undefined ? {} : { agentPreset }),
                ...(document?.name === undefined ? {} : { agentPresetName: document.name }),
                ...(selection === undefined ? {} : { provider: selection.provider, model: selection.model }) };
        }
    };
}
//# sourceMappingURL=session-identity.js.map