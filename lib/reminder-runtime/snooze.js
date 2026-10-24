import { z } from 'zod';
export const SNOOZE_TOOL = 'reminder_snooze';
const FORMAT = 'context-care/snooze/v1';
export const SnoozeWindow = z.object({ sourceId: z.string().min(1), ruleId: z.string().min(1),
    key: z.string().min(1), until: z.number().finite() }).strict();
export const SnoozeResult = z.object({ format: z.literal(FORMAT), sessionId: z.string().min(1),
    summary: z.string(), windows: z.array(SnoozeWindow) }).strict();
/** Facts selected by one real tool invocation, not a snapshot of reminder state. */
export function snoozeResult(sessionId, windows) {
    return { format: FORMAT, sessionId, windows, summary: windows.length
            ? `已暂停 ${windows.length} 条当前窗口提醒，窗口结束后自动恢复。` : '当前没有可暂停的时间窗口提醒。' };
}
/** Nested dispatches also retain content, even when presentationMeta is omitted. */
export const snoozeOutput = {
    schema: { type: 'object', additionalProperties: false, required: ['format', 'sessionId', 'summary', 'windows'], properties: {
            format: { type: 'string', enum: [FORMAT] }, sessionId: { type: 'string' }, summary: { type: 'string' },
            windows: { type: 'array', items: { type: 'object', additionalProperties: false,
                    required: ['sourceId', 'ruleId', 'key', 'until'], properties: { sourceId: { type: 'string' },
                        ruleId: { type: 'string' }, key: { type: 'string' }, until: { type: 'number' } } } },
        } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(SnoozeResult.parse(value)) }],
    presentationMeta: (_args, value) => SnoozeResult.parse(value),
};
/** Read the committed result, never reselect rules using today's definitions. */
export function readSnoozeResult(content, meta) {
    const retained = SnoozeResult.safeParse(meta);
    if (retained.success)
        return retained.data;
    for (const block of content) {
        if (block === null || typeof block !== 'object' || Array.isArray(block))
            continue;
        const text = 'text' in block && typeof block.text === 'string' ? block.text : undefined;
        if (text === undefined || !('type' in block) || block.type !== 'text')
            continue;
        let value;
        try {
            value = JSON.parse(text);
        }
        catch (error) {
            if (!(error instanceof SyntaxError))
                throw error;
            continue; // Older plain-text results carry no exact window identities.
        }
        const parsed = SnoozeResult.safeParse(value);
        if (parsed.success)
            return parsed.data;
    }
    return undefined;
}
//# sourceMappingURL=snooze.js.map