import { z } from 'zod';
import { BatchAnswer, BatchResult, MatchResult } from './state.js';
/** Validate one untrusted worker item independently of scheduling and I/O. */
export function parseRuleAnswer(raw) {
    const parsed = BatchAnswer.safeParse(raw);
    if (!parsed.success)
        return { error: new Error('reminder-result-invalid') };
    if ('error' in parsed.data)
        return { error: parsed.data.error };
    const match = MatchResult.safeParse(parsed.data.match);
    return match.success ? { match: match.data } : { error: new Error('reminder-result-invalid') };
}
const Interrupted = z.object({ code: z.literal('CONTEXT_CARE_MATCH_FAILED'), checkpoint: z.object({
        index: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(), completedMs: z.number().nonnegative(), roundLimited: z.boolean(),
    }) });
/**
 * Resume only the suffix proven not to have started by the worker checkpoint.
 * Completed results survive termination; the interrupted judge is never replayed.
 * Every healthy round uses one batch, in the same order as sequential evaluation.
 */
export async function evaluateRules(input) {
    const answers = new Map(), blockedGroups = new Set();
    const byKey = new Map(input.rules.map(rule => [rule.key, rule]));
    let pending = input.rules, remainingMs = input.remainingMs;
    const record = (raw) => {
        if (raw === null || typeof raw !== 'object' || !('key' in raw) || typeof raw.key !== 'string')
            return;
        const rule = byKey.get(raw.key);
        if (!rule || answers.has(rule.key))
            return;
        const answer = parseRuleAnswer(raw);
        answers.set(rule.key, answer);
        if (rule.exclusiveGroup && (answer.error !== undefined || answer.match?.ok || answer.match?.status === 'unavailable'))
            blockedGroups.add(rule.exclusiveGroup);
    };
    while (pending.length && !input.signal.aborted) {
        if (remainingMs <= 0)
            break;
        try {
            const raw = await input.execute({ reminderBatch: { event: input.event, maxBytes: input.maxBytes, countLimits: input.countLimits,
                    rules: pending, budgetMs: remainingMs, blockedGroups: [...blockedGroups] } }, input.signal, { onDispatch: () => { }, workTimeoutMs: input.ruleTimeoutMs, onItem: record });
            const result = BatchResult.parse(raw);
            for (const item of result.items)
                record(item);
            remainingMs = Math.max(0, remainingMs - result.elapsedMs);
            // A soft stop is budget exhaustion. It is not permission to rerun a judge.
            for (const rule of pending)
                if (!answers.has(rule.key) && !(rule.exclusiveGroup && blockedGroups.has(rule.exclusiveGroup))) {
                    answers.set(rule.key, { error: new Error(result.stopped ? 'reminder-round-timeout' : 'reminder-result-missing'), notStarted: result.stopped });
                }
            pending = [];
        }
        catch (error) {
            const interrupted = Interrupted.safeParse(error);
            if (input.signal.aborted || !interrupted.success || interrupted.data.checkpoint.index >= pending.length) {
                for (const rule of pending)
                    if (!answers.has(rule.key) && !(rule.exclusiveGroup && blockedGroups.has(rule.exclusiveGroup))) {
                        answers.set(rule.key, { error: input.signal.aborted ? input.signal.reason : error });
                    }
                pending = [];
                break;
            }
            const checkpoint = interrupted.data.checkpoint;
            remainingMs = Math.max(0, remainingMs - checkpoint.completedMs - checkpoint.elapsedMs);
            // Messages queued before worker exit have already been received. A missing
            // earlier checkpoint is a protocol failure, never evidence of no execution.
            for (const rule of pending.slice(0, checkpoint.index)) {
                if (!answers.has(rule.key) && !(rule.exclusiveGroup && blockedGroups.has(rule.exclusiveGroup))) {
                    answers.set(rule.key, { error: new Error('reminder-checkpoint-missing') });
                }
            }
            const failed = pending[checkpoint.index];
            // Exit can occur after this item was already delivered. Its real result
            // remains authoritative; only a missing answer represents interrupted work.
            if (!answers.has(failed.key)) {
                answers.set(failed.key, { error });
                if (failed.exclusiveGroup)
                    blockedGroups.add(failed.exclusiveGroup);
            }
            pending = pending.slice(checkpoint.index + 1);
        }
    }
    for (const rule of pending)
        if (!answers.has(rule.key) && !(rule.exclusiveGroup && blockedGroups.has(rule.exclusiveGroup))) {
            answers.set(rule.key, { error: input.signal.aborted ? input.signal.reason : new Error('reminder-round-timeout'), notStarted: true });
        }
    return { answers, remainingMs };
}
//# sourceMappingURL=evaluation.js.map