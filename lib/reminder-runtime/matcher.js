import { z } from 'zod';
import { performance } from 'node:perf_hooks';
import { matchReminderCondition } from './conditions.js';
import { Event, Detector, errorMessage } from './state.js';
const Input = z.object({ condition: z.unknown(), event: Event, maxBytes: z.number().int().positive(),
    judge: Detector.optional(), params: z.json().optional() }).strict();
const Judged = z.object({ ok: z.boolean(), facts: z.record(z.string(), z.json()).optional() }).catchall(z.json());
const moduleRecord = (value) => value !== null && typeof value === 'object';
const Batch = z.object({
    event: Event,
    maxBytes: z.number().int().positive(),
    /** 整批的工作预算，由工作侧自己读取：观察侧超时只能整批掐死，会丢掉已经算完的规则。 */
    budgetMs: z.number().nonnegative().optional(),
    rules: z.array(z.object({ key: z.string().min(1), condition: z.unknown() }).strict()).max(2048),
}).strict();
const micros = (value) => Math.round(value * 1000) / 1000;
const errorName = (error) => error instanceof Error ? error.name : 'Error';
const snapshotOf = (event) => z.json().parse({ event, tool: event, facts: event.facts, context: event.context ?? {} });
/**
 * 条件树在注册时就已经编译好并检查过预算了——`compileRule` 内部走的就是
 * `compileReminderCondition`，结果存在 `condition` 字段里。
 * 执行期只需要用它，不需要把同一棵树再重建一遍：那是每轮每条规则都付一次的纯浪费。
 */
const conditionOf = (raw) => raw;
/** Worker entry for reminder JSON. Native regex and plugin judges share the worker's cancellation budget. */
export async function executeReminderMatch(raw) {
    const input = Input.parse(raw);
    const { event, judge } = input;
    const matched = await matchOf(event, input.condition, snapshotOf(event), judge, input.params);
    return bounded(matched, input.maxBytes);
}
/**
 * 一批规则在一次往返里算完。
 * 检查点放在规则边界上：单条规则内部没法安全打断（判定器是别人的代码），
 * 但规则之间停得下来，已经算完的结果照常带回去——这比整批掐死强得多。
 */
export async function executeReminderBatch(raw, onItem) {
    const input = Batch.parse(raw);
    const began = performance.now();
    // 同一批规则看的是同一份事件，快照只序列化一次，而不是每条规则重做一遍。
    const snapshot = snapshotOf(input.event);
    const items = [];
    let stopped = false;
    for (const rule of input.rules) {
        if (input.budgetMs !== undefined && performance.now() - began > input.budgetMs) {
            stopped = true;
            break;
        }
        const started = performance.now();
        // 每算完一条立刻上报，不等整批结束：这一批如果之后被终止，已经算完的规则不会一起蒸发。
        const settle = (item) => { items.push(item); onItem?.(item); };
        try {
            const matched = bounded(await matchOf(input.event, rule.condition, snapshot), input.maxBytes);
            settle({ key: rule.key, ms: micros(performance.now() - started), match: matched });
        }
        catch (error) {
            settle({ key: rule.key, ms: micros(performance.now() - started), error: { name: errorName(error), message: errorMessage(error) } });
        }
    }
    return { items, stopped, elapsedMs: micros(performance.now() - began) };
}
/**
 * 一条规则的实际匹配：用已编译的条件树匹配，必要时调用登记过的判定器。
 * 判定器只出现在单条路径上——批量那条路不含判定器，因为它们需要各自的终止边界。
 */
async function matchOf(event, raw, snapshot, judge, params) {
    const matched = matchReminderCondition(conditionOf(raw), snapshot, event.textSamples ?? []);
    if (matched.status !== 'matched' || judge === undefined)
        return matched;
    return judged(judge, event, params, matched);
}
/** 判定器是同步导入 + 异步求值，返回它的裁决拼进匹配结果。 */
async function judged(judge, event, params, matched) {
    const loaded = await import(judge.module);
    if (!moduleRecord(loaded))
        throw new Error('reminder-judge-export-missing');
    const evaluate = loaded[judge.exportName];
    if (typeof evaluate !== 'function')
        throw new Error('reminder-judge-export-missing');
    const result = Judged.parse(await evaluate({ event, params }));
    return { ...matched, ok: result.ok, status: result.ok ? 'matched' : 'unmatched', facts: result.facts ?? {} };
}
/**
 * 结果的字节上限。先算大小再校验可序列化：超预算的那条规则不必再走一遍递归校验，
 * 而通过的那条仍然要校验，否则 undefined/NaN 会被 JSON 悄悄丢掉，换个样子当成答案。
 */
function bounded(value, maxBytes) {
    const text = JSON.stringify(value);
    if (text === undefined)
        throw new Error('reminder-result-not-json');
    if (Buffer.byteLength(text) > maxBytes)
        throw new Error('reminder-result-budget-exceeded');
    z.json().parse(value);
    return value;
}
//# sourceMappingURL=matcher.js.map