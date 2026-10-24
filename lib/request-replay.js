import { z } from 'zod';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// Messages come from already-admitted Session data. Check the projection fields
// we consume without stripping provider-owned content or attachment references.
const message = z.custom(value => object(value)
    && typeof value.role === 'string' && Array.isArray(value.content));
const Prompt = z.object({ callId: z.string(), message: message.optional(),
    segments: z.array(z.record(z.string(), z.json())) }).passthrough();
const Workbench = z.object({ callId: z.string(), diff: z.object({
        after: z.object({ system: z.string().optional(), messages: z.array(message) })
    }) }).passthrough();
/**
 * Read request-only inputs already committed by their producer.
 * @param event a committed Session event
 * @returns logged input changes, or undefined for unrelated events
 */
export function requestDecision(event) {
    if (event.type !== 'request/header')
        return undefined;
    const prompt = 'contextCarePrompt' in event.data ? Prompt.parse(event.data.contextCarePrompt) : undefined;
    const workbench = 'contextCareWorkbench' in event.data ? Workbench.parse(event.data.contextCareWorkbench) : undefined;
    if (!prompt && !workbench)
        return undefined;
    return { seq: event.seq, prompt, workbench };
}
/**
 * Reconstruct one settled conversation's input using the native Session surface
 * projection. Only calibration misses need this; no provider or judge is called.
 * @param sessions - the existing detached-session constructor.
 * @param session - the original event log.
 * @param record - the settlement to price.
 * @returns the historical input, including committed request-only changes.
 */
export function replayRequest(sessions, session, record) {
    const prefix = [...session.snapshotEvents(undefined, record.data.eventSeq)];
    const restored = sessions.prepare(undefined, { seed: prefix });
    const header = restored.requestHeader();
    if (!header)
        throw new Error('context-care: settled request has no logged header');
    let prompt;
    let workbench;
    // Request-only inputs apply to one attempt, not every later request that reuses its header.
    for (let index = prefix.length - 1; index >= 0; index--) {
        const event = prefix[index];
        if (event.type === 'assistant/message' || event.type === 'assistant/attempt'
            || event.type === 'step/start' || event.type === 'compaction/summary')
            break;
        const decision = requestDecision(event);
        prompt ??= decision?.prompt;
        workbench ??= decision?.workbench;
    }
    const request = { ...header.config, sessionId: session.id, toolHistory: restored.toolHistory(),
        messages: workbench?.diff.after.messages ?? restored.deriveMessages(),
        ...(header.tools === undefined ? {} : { tools: header.tools }),
        ...(workbench?.diff.after.system === undefined ? {} : { system: workbench.diff.after.system }) };
    if (prompt?.message && !workbench) {
        request.messages = [...request.messages, prompt.message];
    }
    return { session: restored, request, promptDecision: prompt, sourceSeqs: [...restored.surface.nodes] };
}
//# sourceMappingURL=request-replay.js.map