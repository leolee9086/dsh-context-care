import { randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Source, ReminderConfig, compileRule } from './schema.js';
import { CapacitySettings, CapacityError } from './capacity.js';
import { localWindow, humanActivity, requestContext, requestEligible } from './request-context.js';
import { matchesScope } from './scope.js';
import { changeClaims, quotaFor, hasClaim } from './claims.js';
import { createDenialTickets, openPreExecution, codeForReason, codeForFailure } from './denial.js';
import { SESSION_EVENT_TYPES } from './generated/session-events.js';
/** Built-in names, which a custom event may not shadow. */
const BUILT_IN_EVENT_NAMES = new Set(SESSION_EVENT_TYPES);
import { parseOrThrow } from './schema-error.js';
import { Detector, SessionState, Event, MatchResult, BatchResult, BatchAnswer, AnalysisFacts, jsonCopy, errorMessage, errorDetail } from './state.js';
export { ReminderConfig } from './schema.js';
export { REMINDER_DOMAIN } from './state.js';
export const REMINDER_SERVICE = 'reminderRules';
/**
 * Source kind of a reminder delivery. It also guards session-event matching:
 * a delivery is itself a logged message, so matching must not consume its own output.
 */
export const REMINDER_MESSAGE_KIND = 'plugin:dsh-context-care:reminder';
const keyOf = (sourceId, ruleId) => JSON.stringify([sourceId, ruleId, 'model']);
const sourceSignature = (source, rule) => createHash('sha256').update(JSON.stringify({
    plugin: source.plugin, sessionId: source.sessionId, scope: source.scope, rule,
})).digest('hex');
/**
 * The frozen event facts a reminder template may read. Captures, counts and the
 * decision itself live beside these in the same evidence record, so one snapshot
 * answers every question the template can ask.
 */
function frozenFacts(event) {
    return AnalysisFacts.parse(jsonCopy({ type: event.type, name: event.name, arguments: event.arguments,
        error: event.error, output: event.output, clock: event.clock, humanActivity: event.humanActivity }));
}
function reminderKeys(message) {
    if (message.source?.kind !== REMINDER_MESSAGE_KIND)
        return [];
    if (!message.source.reminder)
        throw new Error('reminder-message-key-missing');
    return [message.source.reminder.key];
}
function reminderSource(candidate) {
    return { kind: REMINDER_MESSAGE_KIND, form: 'notice', summary: candidate.title,
        reminder: { key: candidate.key, candidateId: candidate.id },
        contextCareTrace: { trigger: 'reminder-rule', evaluationId: candidate.id, ruleId: candidate.ruleId,
            sourceId: candidate.sourceId, callId: candidate.eventId, rule: candidate.rule, evidence: candidate.evidence,
            ...(candidate.output ? { output: candidate.output } : {}) } };
}
function reminderMessage(candidate, messageId) {
    // IDs are allocated by this runtime and retained through reservation/recovery.
    return { id: messageId, role: 'user', content: [{ type: 'text', text: candidate.text }],
        source: reminderSource(candidate) };
}
/** One runtime owns source snapshots, evaluation lifetimes and durable candidate records.
 * save ACKs before publishing state; execute must settle cancellation after its worker stops.
 * No Cordis or live session objects enter the scheduler. */
export function createReminderRuntime({ config: input, entries = [], templates, save = async () => { }, execute = async () => { throw new Error('reminder-executor-unavailable'); }, capacity, saveCapacity = async () => { }, dispatches = false, resolvePreset, resolveIdentity, updateClaims, wallNow = () => Date.now(), now = () => performance.now(), eligible = () => true, epoch = () => 0, report = () => { } } = {}) {
    const config = ReminderConfig.parse(input);
    let settings = CapacitySettings.parse(capacity ?? { revision: 0, maxRules: config.maxRules });
    let capacityWrite = Promise.resolve();
    const rejectedSources = new Map();
    const records = new Map([...entries].map(([id, value]) => [id, SessionState.parse(jsonCopy(value))]));
    // Only candidates loaded at startup may rebind to an identical source definition.
    const recovered = new Set([...records.values()].flatMap(state => state.candidates.map(candidate => candidate.id)));
    const sources = new Map(), detectors = new Map(), analyzers = new Map();
    const chains = new Map(), queues = new Map(), running = new Map();
    const failures = new Map(), admissions = new Set();
    let closed = false, pumping = false;
    // Tickets outlive one evaluation round but never a policy change; a stale ticket must not permit a call.
    const tickets = createDenialTickets(config.ruleTimeoutMs * 4, () => performance.now());
    // Reminder-caused activations per session. A human turn breaks the chain; the
    // budget is what stops two rules from ping-ponging without a shared causal store.
    const reminderChains = new Map();
    // Declared custom events: a rule may select one by name once its owner declares it.
    const customEvents = new Map();
    const declaredEvents = () => ({ names: new Set(customEvents.keys()), shapes: customEvents });
    /**
     * Whether loop prevention suppresses this activation. A reminder may not be re-activated
     * by the message it generated itself, and reminder-caused activations share one budget
     * per session. A due denial is never suppressed: loop prevention must not allow a call
     * that should still be refused.
     */
    function loopBlocked(event, sourceId, ruleId, effect) {
        if (event.origin !== 'reminder' || effect === 'deny-tool')
            return false;
        return event.causationId === `${sourceId}:${ruleId}` || (reminderChains.get(event.sessionId) ?? 0) > config.maxReminderChain;
    }
    const empty = () => ({ seen: [], candidates: [], diagnostics: [], windows: [], stickies: [] });
    const serial = (id, fn) => {
        const task = (chains.get(id) ?? Promise.resolve()).catch(() => { }).then(fn);
        chains.set(id, task);
        return task;
    };
    /**
     * Reject an unusable body while the source is being registered, so a broken
     * template never reaches delivery. Without the engine, only fixed text is legal.
     */
    function validateText(source) {
        if (templates)
            return templates.validate(source);
        if (source.includes('{{'))
            throw new Error('reminder-template-engine-unavailable');
    }
    /** Render a body once; the injected engine is the only substitution mechanism. */
    function renderText(source, snapshot) {
        return templates ? templates.render(source, snapshot) : source;
    }
    async function claims(operation) {
        if (!updateClaims)
            throw new Error('reminder-shared-storage-unavailable');
        return updateClaims(book => changeClaims(book, { ...operation, at: wallNow(), maxBytes: config.maxClaimBytes }));
    }
    /**
     * 待落盘的最新快照，每个会话一份。
     *
     * 状态是整份覆盖的，所以"写最新的一份"与"把每一次中间态都写一遍"等价，
     * 但前者在慢盘时只写一次、后者会把队列堆成 N 份。只留最新那份是关键：
     * 顺序由"只有一个写者"保证，积压由"合并"消除。
     */
    const dirty = new Map();
    /** 每个会话当前正在跑的写盘循环；有它就意味着写者已经存在，不再另起一个。 */
    const flushing = new Map();
    /**
     * 一个会话只有一个写者，从头到尾把当前最新快照写出去，写完再看有没有新的。
     * 失败不重试：把快照放回待写位，等下一次状态变更再试——
     * 无限重试会把一次坏盘变成忙等。
     */
    /**
     * 写者刻意**不设**自己的超时。
     *
     * 底层 save 一旦发出就取消不了；这里若放弃等待，下一次写入就会和它并发，
     * 落盘顺序又乱了——那正是这套机制要修的东西。所以写者只做两件事：
     * 严格串行、只留最新一份。慢盘时它只是慢，不会错。
     *
     * 失败的那份留在 dirty 里，等下一次状态变更、或者 close 时重试。
     * 没有新变更时它就躺着——这是写回策略的固有性质：盘上可能暂时落后于内存，
     * 但永远不会比内存新。failures 让这个落后可观测。
     */
    async function flush(id) {
        while (dirty.has(id)) {
            const next = dirty.get(id);
            dirty.delete(id);
            try {
                await save(id, next);
            }
            catch (error) {
                // 快照放回待写位，等下一次状态变更重试；错误照抛给等着的那一方——
                // 写入失败必须能被调用方看见，否则回滚和预留补偿就都不会发生。
                dirty.set(id, next);
                throw error;
            }
            failures.delete(id);
        }
    }
    /**
     * 把一份状态交给写者，最多等 storageTimeoutMs。
     * 超时不抛错：内存状态照常前进，下一次写入会把整份快照补上。
     * 真正的失败仍然抛给调用方，让同一次收集里的补偿逻辑照常跑。
     */
    async function persist(id, next) {
        // 关闭之后的变更不再入队：没有写者会来认领它，等它只会让 close 白等。
        if (closed)
            return;
        dirty.set(id, next);
        let writing = flushing.get(id);
        if (writing === undefined) {
            writing = flush(id).finally(() => flushing.delete(id));
            // 写者自己的失败由每一个 await 它的调用方各自接收；这里先吞一次，
            // 免得"没人等它"的时刻变成未处理拒绝。
            writing.catch(() => { });
            flushing.set(id, writing);
        }
        let timer;
        try {
            await Promise.race([
                writing,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('reminder-storage-timeout')), config.storageTimeoutMs);
                }),
            ]);
        }
        catch (error) {
            failures.set(id, error);
            // 超时是盘慢，不是内容错：让状态在内存里前进，这一轮的判定不该被磁盘速度决定。
            if (errorMessage(error) === 'reminder-storage-timeout')
                return;
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function update(id, change, onFailure) {
        return serial(id, async () => {
            try {
                const next = structuredClone(records.get(id) ?? empty());
                // Window claims outlive candidate eviction and surface compaction, but expire at the local window end.
                next.windows = (next.windows ?? []).filter(item => item.until > wallNow());
                for (const candidate of next.candidates) {
                    if (candidate.window && wallNow() >= candidate.window.end)
                        candidate.status = 'discarded';
                }
                const value = await change(next);
                next.diagnostics = next.diagnostics.slice(-config.maxCandidates);
                next.seen = next.seen.slice(-config.maxQueued * 4);
                // Do not evict an undelivered candidate to make space for a new one.
                while (next.candidates.length > config.maxCandidates) {
                    const index = next.candidates.findIndex(item => item.status === 'delivered' || item.status === 'discarded');
                    if (index < 0)
                        throw new Error('reminder-candidate-capacity-exceeded');
                    next.candidates.splice(index, 1);
                }
                if (Buffer.byteLength(JSON.stringify(next)) > config.maxBytes)
                    throw new Error('reminder-retained-budget-exceeded');
                await persist(id, next);
                records.set(id, next);
                return value;
            }
            catch (error) {
                // Compensation finishes inside the session queue, before another collection can retry.
                if (onFailure) {
                    try {
                        await onFailure();
                    }
                    catch (releaseError) {
                        throw new AggregateError([error, releaseError], 'reminder-reservation-release-failed');
                    }
                }
                throw error;
            }
        });
    }
    function fresh(candidate) {
        const at = wallNow();
        if (candidate.window && (at < candidate.window.start || at >= candidate.window.end))
            return false;
        return !candidate.request || requestEligible(candidate.rule, { ...candidate.request, clock: { at } });
    }
    async function identity(sessionId, agentPreset, signal) {
        // Host identity is read afresh at each boundary; event metadata never overrides it.
        signal?.throwIfAborted();
        if (resolveIdentity) {
            const facts = await resolveIdentity(sessionId, signal);
            signal?.throwIfAborted();
            return { ...facts, sessionId };
        }
        const preset = resolvePreset ? resolvePreset(sessionId) : agentPreset;
        return { sessionId, ...(preset === undefined ? {} : { agentPreset: preset }) };
    }
    function sourceAccepts(item, target) {
        const source = item.value;
        return item.acceptSession(target.sessionId)
            && (source.sessionId === undefined || source.sessionId === target.sessionId)
            && matchesScope(target, source.scope ?? {});
    }
    function ruleAccepts(rule, target) {
        return matchesScope(target, rule.scope ?? {});
    }
    function current(candidate, target) {
        const source = sources.get(candidate.sourceId);
        const rule = source?.value.rules.find(value => value.id === candidate.ruleId);
        if (!source || !rule)
            return false;
        const sameDefinition = source.token === candidate.sourceToken || (recovered.has(candidate.id)
            && candidate.sourceSignature === sourceSignature(source.value, rule));
        return sameDefinition && sourceAccepts(source, target) && ruleAccepts(rule, target);
    }
    function diagnostic(id, detail) {
        return update(id, state => state.diagnostics.push(AnalysisFacts.parse(jsonCopy({ at: Date.now(), ...detail })))).catch(report);
    }
    /**
     * Move every sticky activation one clock tick. An activation delivers while it
     * has active ticks left, stands silent through its cooldown, and is dropped once
     * both are spent: a new event is then required to activate the rule again.
     * A tick never refreshes the activation, so repeated hits cannot extend it.
     */
    function advanceStickies(state, humanId) {
        const ticked = new Set();
        state.stickies = state.stickies.filter(sticky => {
            // A main-request clock advances on every request; a human-turn clock waits for new input.
            if (sticky.clock === 'human-turn' && sticky.lastHumanId === humanId)
                return true;
            sticky.lastHumanId = humanId;
            if (sticky.remaining > 0) {
                ticked.add(sticky.activationId);
                return true;
            }
            sticky.cooldown -= 1;
            return sticky.cooldown >= 0;
        });
        return ticked;
    }
    /** Queue this tick's delivery for each activation that still has active ticks. */
    function pendSticky(state, sessionId, ticked) {
        for (const sticky of state.stickies) {
            // Only an activation whose clock actually advanced delivers this request.
            if (sticky.remaining <= 0 || !ticked.has(sticky.activationId))
                continue;
            const source = sources.get(sticky.sourceId);
            const definition = source?.value.rules.find(rule => rule.id === sticky.ruleId);
            const compiled = source?.compiled.find(rule => rule.id === sticky.ruleId);
            // A withdrawn rule or source ends the activation; its text no longer has an owner.
            if (!source || !definition || !compiled) {
                sticky.remaining = 0;
                sticky.cooldown = 0;
                continue;
            }
            // One delivery per lifetime unit: a queued or reserved tick already claims this one.
            const key = JSON.stringify([sticky.sourceId, sticky.ruleId, 'sticky', sticky.activationId, sticky.remaining]);
            if (state.candidates.some(item => item.key === key && (item.status === 'pending' || item.status === 'reserved')))
                continue;
            state.candidates.push({ id: randomUUID(), sessionId, sourceId: sticky.sourceId, sourceToken: source.token,
                sourceSignature: sourceSignature(source.value, definition), ruleId: sticky.ruleId, key,
                revision: source.value.revision, policy: epoch(sessionId, sticky.sourceId, sticky.ruleId),
                text: sticky.text, title: sticky.title, eventId: `sticky:${sticky.activationId}:${sticky.remaining}`,
                rootCallId: `sticky:${sticky.activationId}`, status: 'pending',
                // The activation stores the body its first delivery already rendered, so a
                // later tick reuses that text and must never render the template source again.
                rendered: true,
                evidence: AnalysisFacts.parse(jsonCopy({ sticky: true, activationId: sticky.activationId })),
                sticky: { activationId: sticky.activationId, charged: sticky.charged },
                rule: structuredClone(definition) });
        }
    }
    function invalidate(sourceId) {
        // A changed source can change a denial, so tickets from the old policy must not authorize.
        // Retiring them leaves the policy usable: the next round records the new generation.
        tickets.invalidate();
        if (sources.has(sourceId))
            for (const state of records.values()) {
                for (const candidate of state.candidates)
                    if (candidate.sourceId === sourceId)
                        recovered.delete(candidate.id);
            }
        for (const run of running.values())
            if (run.items.some(item => item.source.sourceId === sourceId))
                run.controller.abort(new Error('reminder-source-changed'));
    }
    function pump() {
        if (pumping || closed)
            return;
        pumping = true;
        try {
            for (const [id, queue] of queues) {
                if (running.size >= config.maxConcurrent)
                    break;
                if (running.has(id) || !queue.length)
                    continue;
                const run = queue.shift();
                if (!run)
                    continue;
                // Move a served session to the tail so it cannot monopolize the next free slot.
                queues.delete(id);
                if (queue.length)
                    queues.set(id, queue);
                running.set(id, run);
                run.task = evaluate(run).catch(error => diagnostic(id, { eventId: run.event.callId, status: 'failed', message: errorMessage(error) }))
                    .finally(() => { clearTimeout(run.timer); running.delete(id); run.resolve(); pump(); });
            }
        }
        finally {
            pumping = false;
        }
    }
    async function evaluate(run) {
        // 预算从评估真正开始时起算，只覆盖分析器与规则匹配。
        run.startBudget?.();
        const { event, items, controller, deadline } = run;
        const blockedGroups = new Set(), winners = new Set(), results = [];
        // Only a pre-execution round can still stop its call; correlation uses the registry's execution token.
        const preExecution = event.type === 'tool.before-execute' ? run.preExecution : undefined;
        const diagnostics = [];
        // Every analyzer reads the same base input; only the matching phase sees their combined facts.
        event.facts = {};
        for (const analyzer of run.analyzers) {
            if (controller.signal.aborted || now() >= deadline)
                break;
            if (analyzers.get(analyzer.ref) !== analyzer)
                continue;
            const child = new AbortController();
            const abort = () => child.abort(controller.signal.reason);
            controller.signal.addEventListener('abort', abort, { once: true });
            let timer;
            const onDispatch = () => { timer ??= setTimeout(() => child.abort(new Error('reminder-analysis-timeout')), Math.max(0, Math.min(config.ruleTimeoutMs, deadline - now()))); };
            if (!dispatches)
                onDispatch();
            try {
                const facts = AnalysisFacts.parse(await execute({ analysis: { analyzer, event: { ...event, facts: {} }, maxBytes: config.maxBytes } }, child.signal, { onDispatch, workTimeoutMs: config.ruleTimeoutMs }));
                child.signal.throwIfAborted();
                if (now() >= deadline || analyzers.get(analyzer.ref) !== analyzer)
                    continue;
                if (Buffer.byteLength(JSON.stringify({ ...event.facts, [analyzer.ref]: facts })) > config.maxBytes)
                    throw new Error('reminder-facts-budget-exceeded');
                event.facts[analyzer.ref] = facts;
                diagnostics.push({ analyzer: analyzer.ref, revision: analyzer.revision, status: 'analyzed', eventId: event.callId });
            }
            catch (error) {
                diagnostics.push({ analyzer: analyzer.ref, status: child.signal.aborted || /timeout/.test(errorMessage(error)) ? 'timed-out' : 'failed', message: errorMessage(error),
                    ...errorDetail(error), eventId: event.callId });
            }
            finally {
                clearTimeout(timer);
                controller.signal.removeEventListener('abort', abort);
            }
        }
        const entries = items.map(item => {
            const { source, rule, token, policy } = item;
            // 只有主线程才知道的两件事，在交给 worker 之前先查一遍：来源是否已经换代，
            // 判定器是否已经不在了。两者处理方式不同，所以不合并成一个 skip。
            if (sources.get(source.sourceId)?.token !== token || epoch(event.sessionId, source.sourceId, rule.id) !== policy) {
                return { item, skip: 'reminder-source-changed' };
            }
            if (rule.judge && (item.judge?.revision !== rule.judge.revision || detectors.get(rule.judge.ref) !== item.judge)) {
                return { item, skip: 'reminder-judge-unavailable' };
            }
            return { item };
        });
        const queued = entries.filter(entry => entry.skip === undefined).map(entry => entry.item);
        // 判定器是别人的代码，需要它自己的一份时间预算，也需要只掐它一个的终止边界。
        // 这两件事都建立在「一次往返只跑这一条」上，所以带判定器的规则不进批量。
        const batched = queued.filter(item => item.rule.judge === undefined);
        const solo = queued.filter(item => item.rule.judge !== undefined);
        const answers = new Map();
        // 每条规则一个结算口：谁的回执先到谁先落定，和同批的其它规则毫无关系。
        const settled = new Map();
        const settles = queued.map(item => new Promise(resolve => settled.set(item, resolve)));
        const settleItem = (item, value) => {
            const finish = settled.get(item);
            if (finish === undefined)
                return;
            settled.delete(item);
            answers.set(item, value);
            finish(value);
        };
        const outstanding = () => queued.filter(item => settled.has(item));
        /** 这条规则的一行代码还没被执行过（线程被换掉了），换一趟重投不会重复任何副作用。 */
        const restarted = (error) => error?.retryable === true;
        /** 一条规则单飞：批量没把它送到时，用它自己的一趟往返，结局依然只属于它自己。 */
        const alone = async (item) => {
            const child = new AbortController();
            const abort = () => child.abort(controller.signal.reason);
            controller.signal.addEventListener('abort', abort, { once: true });
            const workTimeoutMs = Math.min(config.ruleTimeoutMs, item.rule.judge?.timeoutMs ?? config.ruleTimeoutMs);
            let timer;
            const onDispatch = () => { timer ??= setTimeout(() => child.abort(new Error('reminder-rule-timeout')), Math.max(0, Math.min(workTimeoutMs, deadline - now()))); };
            if (!dispatches)
                onDispatch();
            try {
                const result = MatchResult.parse(await execute({ reminder: { condition: item.rule.condition, event,
                        maxBytes: config.maxBytes,
                        ...(item.judge ? { judge: item.judge, params: item.rule.judge?.params ?? null } : {}) } }, child.signal, { onDispatch, workTimeoutMs }));
                if (child.signal.aborted || controller.signal.aborted)
                    throw child.signal.reason ?? new Error('reminder-round-timeout');
                return { match: result };
            }
            catch (error) {
                return { error };
            }
            finally {
                clearTimeout(timer);
                controller.signal.removeEventListener('abort', abort);
            }
        };
        /** 单飞两次：第二趟时线程上只有它，再失败就是它自己的结局，不再是别人牵连的。 */
        const resolveAlone = async (item) => {
            const first = await alone(item);
            settleItem(item, restarted(first.error) ? await alone(item) : first);
        };
        // 一条回执的处置只有这一处：形状坏掉的只算它自己失败，不牵连同批的其它规则。
        const record = (back) => {
            if (back === null || typeof back !== 'object')
                return;
            const key = back.key;
            if (typeof key !== 'string')
                return;
            const item = batched[Number(key)];
            if (!item)
                return;
            const parsed = BatchAnswer.safeParse(back);
            settleItem(item, !parsed.success ? { error: new Error('reminder-result-invalid') }
                : 'match' in parsed.data ? { match: parsed.data.match } : { error: parsed.data.error });
        };
        // 整轮在投递前就被取消了：每条规则立刻拿到自己的结局，不让谁等一个不会来的回执。
        if (controller.signal.aborted)
            for (const item of queued)
                settleItem(item, { error: controller.signal.reason });
        // 判定器规则各自单飞，立刻出发：它们互不等待，也不等那趟批量。
        // 判定器规则不进批量：它们要自己的一份预算，也要能只掐自己。
        // 注意：批量被打断后，对没拿到回执的规则会重投一次。纯条件匹配是幂等的，
        // 判定器是插件代码——契约要求它无副作用，有副作用的判定器会因此执行两次。
        for (const item of solo)
            if (!controller.signal.aborted)
                void resolveAlone(item);
        if (batched.length && !controller.signal.aborted) {
            const child = new AbortController();
            const abort = () => child.abort(controller.signal.reason);
            controller.signal.addEventListener('abort', abort, { once: true });
            // 批量只省往返，不该让一批获得比单条更多的时间。
            // 原来这里拿的是「整轮剩余」，于是一条规则卡死就能把整轮预算吃光：
            // 同批其它规则的重投全部立刻超时，诊断里把「我没算过」写成 timed-out。
            // 取单条上限之后，卡死那条只吃掉自己那份，剩下的预算够其它规则重投。
            const workTimeoutMs = Math.min(config.ruleTimeoutMs, Math.max(1, deadline - now()));
            let timer;
            const onDispatch = () => { timer ??= setTimeout(() => child.abort(new Error('reminder-rule-timeout')), workTimeoutMs); };
            if (!dispatches)
                onDispatch();
            // 这趟车不等它的整体完成：每条规则自己等自己的回执，谁先到谁先落定。
            // 收尾用自吞的 async 块：.finally() 返回的是新 promise，收尾链自己出错时
            // 没有任何人接，会变成进程级的未处理拒绝，被算到别的用例头上。
            void (async () => {
                try {
                    const raw = await execute({ reminderBatch: {
                            event, maxBytes: config.maxBytes,
                            // 留一点余量，让工作侧先于观察侧停下：这样已经算完的规则才能把结果带回来。
                            budgetMs: Math.max(0, workTimeoutMs - 5),
                            rules: batched.map((item, index) => ({ key: String(index), condition: item.rule.condition })),
                        } }, child.signal, { onDispatch, workTimeoutMs, onItem: record });
                    // 收尾回执再走一遍同一条处置：中途上报的已经落地，这里补的是最后那几条。
                    for (const back of BatchResult.parse(raw).items)
                        record(back);
                }
                catch (error) {
                    // 车翻了。已经落定的规则不受影响，还在等回执的各自补一趟——
                    // 线程虽然没了，这些规则一行都没执行过，换线程重投是安全的。
                    diagnostics.push({ status: 'batch-failed', message: errorMessage(error), ...errorDetail(error), eventId: event.callId });
                }
                finally {
                    clearTimeout(timer);
                    controller.signal.removeEventListener('abort', abort);
                }
                // 工作侧提前停下或整趟失败时，没拿到回执的规则各自单飞，而不是一起作废。
                await Promise.all(outstanding().map(resolveAlone));
            })().catch(() => { });
        }
        // 等每条规则自己的结局。一条卡住不会拖住别的条，它们的结算口早已调用。
        // 但不能只押在 settles 上：外部执行端口不保证会返回，端口一旦不回，
        // 这个 await 就没有出口，evaluate 不返回、run.done 不完成，
        // 这个会话之后所有 submit/collect 都会等在 settle(sessionId) 上。
        // 轮次到点就把还没结算的按超时收掉，让这一轮一定收得了尾。
        await Promise.race([
            Promise.all(settles),
            new Promise(resolve => {
                const timer = setTimeout(resolve, Math.max(0, deadline - now()));
                timer.unref?.();
            }),
        ]);
        for (const item of outstanding())
            settleItem(item, { error: new Error('reminder-round-timeout') });
        // 整轮被取消时还没结局的规则：补一趟单飞，让每条规则都有属于自己的答案。
        for (const item of outstanding()) {
            if (controller.signal.aborted)
                break;
            await resolveAlone(item);
        }
        for (const entry of entries) {
            const { item } = entry;
            const { source, token, rule, policy } = item;
            // 预算只由 run.timer 的中止表达；此处再比一次墙钟会让同一份工作出现两种判定。
            if (controller.signal.aborted) {
                diagnostics.push({ status: 'round-timeout', eventId: event.callId });
                break;
            }
            if (rule.exclusiveGroup && (blockedGroups.has(rule.exclusiveGroup) || winners.has(rule.exclusiveGroup)))
                continue;
            // 预检就不可用：来源换代只是跳过这一条，判定器没了则是这一轮少了一个答案。
            if (entry.skip === 'reminder-source-changed')
                continue;
            if (entry.skip === 'reminder-judge-unavailable') {
                if (rule.exclusiveGroup)
                    blockedGroups.add(rule.exclusiveGroup);
                run.incomplete ??= 'rule-failed';
                diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId, status: 'failed', message: entry.skip });
                continue;
            }
            const answer = answers.get(item);
            // 没有回执：工作侧还没算到这条就停了，或者整批失败。未完成的原因上面已经记过。
            if (answer === undefined)
                continue;
            if (answer.error !== undefined) {
                const failure = errorMessage(answer.error);
                if (rule.exclusiveGroup)
                    blockedGroups.add(rule.exclusiveGroup);
                // 启动失败和规则超时对使用者是两件事，分类不能只看有没有 timeout 字样。
                run.incomplete ??= codeForFailure(failure);
                diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId,
                    status: /timeout/.test(failure) ? 'timed-out' : 'failed', message: failure, ...errorDetail(answer.error) });
                continue;
            }
            // 结果回来了也要再确认一次来源：批量期间别人可能已经换掉了这组规则。
            if (sources.get(source.sourceId)?.token !== token || epoch(event.sessionId, source.sourceId, rule.id) !== policy)
                continue;
            // 回执的形状由批量协议保证，语义仍按单条契约校验：一条结果不合法只算它自己失败。
            const parsed = MatchResult.safeParse(answer.match);
            if (!parsed.success) {
                if (rule.exclusiveGroup)
                    blockedGroups.add(rule.exclusiveGroup);
                run.incomplete ??= 'rule-failed';
                diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId,
                    status: 'failed', message: 'reminder-result-invalid' });
                continue;
            }
            const result = parsed.data;
            try {
                if (result.ok) {
                    const output = rule.on === 'assistant.output' ? event.output : undefined;
                    if (rule.on === 'assistant.output' && !output)
                        throw new Error('reminder-output-evidence-missing');
                    if (rule.exclusiveGroup)
                        winners.add(rule.exclusiveGroup);
                    // A denial and an ordinary reminder take this same path: same validation, same delivery,
                    // same quota. The denial only records that this call must also be refused.
                    const definition = source.rules.find(value => value.id === rule.id);
                    if (!definition)
                        throw new Error('reminder-source-rule-missing');
                    if (rule.effect.kind === 'deny-tool') {
                        run.denial ??= { sourceId: source.sourceId, ruleId: rule.id, reason: rule.effect.reason ?? rule.text };
                    }
                    results.push({ id: randomUUID(), sessionId: event.sessionId, ...(event.agentPreset === undefined ? {} : { agentPreset: event.agentPreset }), sourceId: source.sourceId, sourceToken: token, ruleId: rule.id,
                        key: item.window ? JSON.stringify([source.sourceId, rule.id, 'model', item.window.id]) : keyOf(source.sourceId, rule.id),
                        ...(item.window ? { window: item.window } : {}),
                        ...(rule.on === 'request.before' ? { request: { type: 'request.before', humanActivity: event.humanActivity } } : {}),
                        revision: source.revision, policy, text: rule.text,
                        sourceSignature: sourceSignature(source, definition),
                        ...(output ? { output: { attemptId: output.attemptId, turn: output.turn,
                                step: output.step, index: output.index, type: output.type, offset: output.offset,
                                full: output.full } } : {}),
                        title: rule.title ?? rule.id, eventId: event.callId, rootCallId: event.rootCallId,
                        status: 'pending', evidence: AnalysisFacts.parse(jsonCopy({ ...result, event: frozenFacts(event),
                            ...(rule.on === 'request.before' ? { clock: event.clock, humanActivity: event.humanActivity } : {}) })),
                        rule: structuredClone(definition) });
                }
                if (result.status === 'unavailable' && rule.exclusiveGroup)
                    blockedGroups.add(rule.exclusiveGroup);
                diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId,
                    status: result.status ?? (result.ok ? 'matched' : 'unmatched'),
                    ...(result.status === 'unavailable' ? { evidence: result } : {}) });
            }
            catch (error) {
                if (rule.exclusiveGroup)
                    blockedGroups.add(rule.exclusiveGroup);
                // 这条规则没有答案：整轮不能算完成，否则会把“没评估”当成“没有命中”。
                // 超时和报错都算没有答案，但它们是两种不同的故障，拒绝理由要分开。
                run.incomplete ??= codeForFailure(errorMessage(error));
                diagnostics.push({ ruleId: rule.id, sourceId: source.sourceId, eventId: event.callId,
                    status: /timeout/.test(errorMessage(error)) ? 'timed-out' : 'failed', message: errorMessage(error),
                    ...errorDetail(error) });
            }
        }
        // Reaching the end of the loop is the only proof that no denial rule was skipped.
        // 完成与否只看这一轮有没有被中止：墙钟里还混着状态克隆、磁盘写入和别的主线程占用，
        // 用它判断“评估是否完成”会把与匹配无关的开销算成规则没评完。
        // 中止是整轮级别的事实，比单条规则失败更接近真相，所以它优先决定原因。
        if (controller.signal.aborted)
            run.incomplete ??= codeForReason(controller.signal.reason);
        run.evaluated = run.incomplete === undefined;
        await update(event.sessionId, async (state) => {
            state.diagnostics.push(...diagnostics.map(detail => AnalysisFacts.parse(jsonCopy(detail))));
            if (controller.signal.aborted || closed)
                return;
            const target = await identity(event.sessionId, event.agentPreset, controller.signal);
            // Recorded after the identity recheck, so a decision revoked during the round never survives it.
            // 未完成时把原因一并交给票据：拒绝理由要说得出是从哪一步失去评估的。
            preExecution?.settle(run.denial, run.evaluated === true, run.incomplete);
            for (const candidate of results) {
                if (controller.signal.aborted || closed || !current(candidate, target) || !eligible(event.sessionId, candidate.sourceId, candidate.ruleId)
                    || epoch(event.sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy)
                    continue;
                for (const old of state.candidates)
                    if (old.status === 'pending' && !fresh(old))
                        old.status = 'discarded';
                if (!state.candidates.some(old => old.key === candidate.key && old.status === 'pending' && current(old, target)))
                    state.candidates.push(candidate);
            }
        });
    }
    /** Single admission path for composed events; a pre-execution round also carries its ticket key. */
    function admit(rawEvent, signal, preExecution) {
        // 每条早退都要先给票据一个明确的结论：缺票据会被读成“评估没做完”，
        // 那就把“服务停了”“队列满了”“事件坏了”说成同一件事，谁也没法据此修。
        if (closed) {
            preExecution?.settleUnfinished('closed');
            return Promise.resolve();
        }
        if (signal?.aborted) {
            preExecution?.settleUnfinished('cancelled');
            return Promise.resolve();
        }
        // Reserve capacity before the first persistence await; pending writes are part of the queue.
        if (admissions.size >= config.maxQueued + config.maxConcurrent) {
            preExecution?.settleUnfinished('capacity');
            return Promise.reject(new Error('reminder-capacity-exceeded'));
        }
        const admittedAt = now(), serialized = JSON.stringify(rawEvent);
        if (Buffer.byteLength(serialized) > config.maxBytes) {
            preExecution?.settleUnfinished('input-budget');
            return Promise.reject(new Error('reminder-input-budget-exceeded'));
        }
        // A rejected submission is reported through the public service, so its reason must survive relay.
        // 解析失败是事件本身坏了，不是评估没跑完：这一档也要自己说清楚。
        let event;
        try {
            event = parseOrThrow('提醒事件无效', () => Event.parse(JSON.parse(serialized)));
        }
        catch (error) {
            preExecution?.settleUnfinished('parse-failed');
            throw error;
        }
        // A human turn breaks the reminder chain; a reminder-caused event extends it. Only
        // derived activations are affected by this count (see loopBlocked).
        if (event.origin === 'human')
            reminderChains.delete(event.sessionId);
        else if (event.origin === 'reminder')
            reminderChains.set(event.sessionId, (reminderChains.get(event.sessionId) ?? 0) + 1);
        // 这一轮最终没给出答案的原因；走不到终点时由它记录，票据据此写出拒绝理由。
        let unfinished = 'unclassified';
        const admission = { sessionId: event.sessionId, controller: new AbortController() };
        admissions.add(admission);
        // Promise invokes its executor synchronously before this resolver is read.
        let resolve;
        const done = new Promise(finish => { resolve = finish; });
        const run = { event, items: [], analyzers: [...analyzers.values()], controller: admission.controller, deadline: admittedAt + config.roundTimeoutMs, resolve, done,
            ...(preExecution === undefined ? {} : { preExecution }) };
        const abort = () => {
            run.controller.abort(signal?.reason ?? new Error('reminder-round-timeout'));
            // 从队列里撤下这一轮：调用方主动取消，还是它自己等到超时，是两种不同的结局。
            unfinished = signal?.aborted ? 'cancelled' : 'round-timeout';
            const queue = queues.get(event.sessionId), index = queue?.indexOf(run) ?? -1;
            if (queue && index >= 0) {
                queue.splice(index, 1);
                if (!queue.length)
                    queues.delete(event.sessionId);
                void diagnostic(event.sessionId, { eventId: event.callId, status: signal?.aborted ? 'cancelled' : 'queue-timeout' }).catch(() => { }).finally(resolve);
            }
        };
        signal?.addEventListener('abort', abort, { once: true });
        // 预算推迟到 evaluate 开头才起算：准入是 I/O，不是评估工作。
        run.startBudget = () => {
            run.deadline = now() + config.roundTimeoutMs;
            run.timer = setTimeout(abort, config.roundTimeoutMs);
        };
        // Identity lookup occupies admission capacity and uses the same round deadline as matching.
        admission.task = identity(event.sessionId, event.agentPreset, run.controller.signal).then(target => {
            if (closed || run.controller.signal.aborted)
                return false;
            run.items = [...sources.values()].filter(item => sourceAccepts(item, target))
                .flatMap(item => item.compiled.filter(rule => ruleAccepts(rule, target) && requestEligible(rule, event)
                && eligible(event.sessionId, item.value.sourceId, rule.id)
                && !loopBlocked(event, item.value.sourceId, rule.id, rule.effect.kind))
                .map(rule => ({ rule, source: item.value, token: item.token, policy: epoch(event.sessionId, item.value.sourceId, rule.id),
                judge: rule.judge ? detectors.get(rule.judge.ref) : undefined,
                window: rule.effect.deliver.model.once === 'window' || rule.effect.deliver.model.shared?.reset === 'window'
                    ? localWindow('timeWindow' in rule.when ? rule.when.timeWindow : undefined, event.clock?.at) : undefined })))
                .sort((a, b) => b.rule.priority - a.rule.priority || a.source.sourceId.localeCompare(b.source.sourceId) || a.rule.id.localeCompare(b.rule.id));
            if (!run.items.length) {
                // No rule in this session's policy applies to this call, so the evaluation is
                // complete: record that answer. The guard reads a ticket for every call, and an
                // unmatched tool is a verdict, not a missing one.
                preExecution?.settle(undefined, true);
                return false;
            }
            return update(event.sessionId, state => {
                if (run.controller.signal.aborted)
                    return false;
                // 同一个 callId 已经有一轮在跑：这次提交没得到属于自己的答案。
                if (state.seen.includes(event.callId)) {
                    unfinished = 'duplicate-call';
                    return false;
                }
                state.seen.push(event.callId);
                return true;
            });
        }).then(admitted => {
            if (!admitted || closed || run.controller.signal.aborted)
                return;
            const queue = queues.get(event.sessionId) ?? [];
            queue.push(run);
            queues.set(event.sessionId, queue);
            pump();
            return done;
        }).catch(async (error) => {
            // 身份查询失败：还没看过任何规则，和规则超时不是一回事。
            if (!run.controller.signal.aborted) {
                unfinished = 'identity';
                throw error;
            }
            await diagnostic(event.sessionId, { eventId: event.callId, status: signal?.aborted ? 'cancelled' : 'queue-timeout' });
        }).finally(() => {
            clearTimeout(run.timer);
            signal?.removeEventListener('abort', abort);
            admissions.delete(admission);
            // Every preparation ends with a verdict. A round that never ran (capacity, cancellation,
            // queue timeout, duplicate call id) settles as an unfinished evaluation, which denies, so
            // the guard never has to interpret an absence.
            preExecution?.settleUnfinished(unfinished);
        });
        return admission.task;
    }
    function catalogFor(acceptSource, acceptRule) {
        return [...sources.values()].filter(acceptSource).map(item => item.value)
            .map(source => ({ sourceId: source.sourceId, plugin: source.plugin, registration: 'reminderRules', executor: 'context-care',
            ...(source.sessionId ? { sessionId: source.sessionId } : {}), ...(source.scope ? { scope: source.scope } : {}), readOnly: true,
            rules: source.rules.filter(acceptRule).map(rule => ({ id: rule.id, title: rule.title ?? rule.id, description: rule.text,
                definition: rule, actions: [{ id: 'model', title: '模型提醒', defaultEnabled: true }] })) }));
    }
    const registeredRules = () => [...sources.values()].reduce((count, item) => count + item.compiled.length, 0);
    const capacitySnapshot = () => structuredClone({ ...settings, registeredRules: registeredRules(), rejections: [...rejectedSources.values()] });
    return {
        capacitySnapshot,
        /** Evaluate natural conversation at the same boundary that collects tool reminders. */
        async prepareRequest({ sessionId, agentPreset, events, visible = [], accepted = [], signal }) {
            if (![...sources.values()].some(source => source.compiled.some(rule => rule.on === 'request.before')))
                return;
            const at = wallNow(), callId = `request:${randomUUID()}`;
            await this.submit({ type: 'request.before', sessionId, ...(agentPreset === undefined ? {} : { agentPreset }), callId, rootCallId: callId,
                clock: { at, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                humanActivity: humanActivity(events), context: requestContext([...visible, ...accepted], config) }, signal);
        },
        /** Persist suppression through the active calendar window; omitted identity selects all window rules. */
        async snooze({ sessionId, agentPreset, sourceId, ruleId }) {
            if (closed)
                throw new Error('reminder-runtime-closed');
            if ((sourceId === undefined) !== (ruleId === undefined))
                throw new Error('sourceId and ruleId must be supplied together');
            const target = await identity(sessionId, agentPreset);
            const selected = [...sources.values()].filter(source => sourceAccepts(source, target)
                && (sourceId === undefined || source.value.sourceId === sourceId))
                .flatMap(source => source.compiled.filter(rule => rule.effect.kind === 'remind'
                && rule.effect.deliver.model.once === 'window'
                && ruleAccepts(rule, target)
                && (ruleId === undefined || rule.id === ruleId)).map(rule => ({ sourceId: source.value.sourceId, rule })));
            return update(sessionId, state => {
                const suppressed = [];
                for (const item of selected) {
                    const window = localWindow('timeWindow' in item.rule.when ? item.rule.when.timeWindow : undefined, wallNow());
                    if (!window)
                        continue;
                    const key = JSON.stringify([item.sourceId, item.rule.id, 'model', window.id]);
                    state.windows = state.windows.filter(claim => claim.key !== key);
                    state.windows.push({ key, until: window.end });
                    suppressed.push({ sourceId: item.sourceId, ruleId: item.rule.id, until: window.end });
                }
                return suppressed;
            });
        },
        setCapacity(input) {
            const change = CapacitySettings.parse(input);
            const task = capacityWrite.catch(() => { }).then(async () => {
                if (closed)
                    throw new CapacityError(503, '提醒服务已关闭');
                if (change.revision !== settings.revision)
                    throw new CapacityError(409, '提醒容量已被其他窗口修改，请刷新后重试');
                const next = { revision: settings.revision + 1, maxRules: change.maxRules };
                // Only durable acknowledgement publishes a new setting; a failed write is retryable.
                await saveCapacity(next);
                settings = next;
                return capacitySnapshot();
            });
            capacityWrite = task;
            return task;
        },
        validateRule(input) { return structuredClone(compileRule(input, config.countLimits, declaredEvents())); },
        registerSource(input, { acceptSession = () => true } = {}) {
            if (closed)
                throw new Error('reminder-runtime-closed');
            // Registration is a public entry point; a rejected declaration must carry its reason.
            const value = parseOrThrow('提醒来源无效', () => Source.parse(input));
            if (sources.has(value.sourceId))
                throw new Error('reminder-source-already-registered');
            const owner = {};
            const replace = (input) => {
                if (closed || (sources.has(value.sourceId) && sources.get(value.sourceId)?.owner !== owner))
                    throw new Error('reminder-source-disposed');
                const next = parseOrThrow('提醒来源无效', () => Source.parse(input));
                if (next.sourceId !== value.sourceId || next.plugin !== value.plugin || next.sessionId !== value.sessionId)
                    throw new Error('reminder-source-identity-changed');
                const previousCount = registeredRules();
                const totalRules = previousCount - (sources.get(next.sourceId)?.compiled.length ?? 0) + next.rules.length;
                // Lowering a limit preserves registered rules. Only growth is refused until capacity is available.
                if (settings.maxRules && totalRules > settings.maxRules && totalRules > previousCount) {
                    const message = `提醒规则总数 ${totalRules} 超过上限 ${settings.maxRules}（来源 ${next.sourceId}：${next.rules.length} 条）`;
                    rejectedSources.set(next.sourceId, { sourceId: next.sourceId, sourceRules: next.rules.length, totalRules, limit: settings.maxRules, message });
                    throw Object.assign(new Error(message), { code: 'reminder-capacity-exceeded' });
                }
                if (new Set(next.rules.map(rule => rule.id)).size !== next.rules.length)
                    throw new Error('reminder-duplicate-rule');
                // A body that cannot render is rejected here, before any rule can match.
                for (const rule of next.rules)
                    validateText(rule.text);
                const compiled = next.rules.map(rule => compileRule(rule, config.countLimits, declaredEvents()));
                if (!updateClaims && compiled.some(rule => rule.effect.kind === 'remind' && rule.effect.deliver.model.shared))
                    throw new Error('reminder-shared-storage-unavailable');
                invalidate(value.sourceId);
                rejectedSources.delete(next.sourceId);
                sources.set(value.sourceId, { owner, acceptSession, token: randomUUID(), value: next, compiled });
            };
            replace(value);
            let disposed = false;
            return { replace: (next) => { if (disposed)
                    throw new Error('reminder-source-disposed'); replace(next); },
                async dispose() {
                    if (disposed)
                        return;
                    disposed = true;
                    invalidate(value.sourceId);
                    sources.delete(value.sourceId);
                    await Promise.allSettled([...running.values()].filter(run => run.items.some(item => item.source.sourceId === value.sourceId)).map(run => run.task));
                } };
        },
        registerDetector(input) {
            const value = Detector.parse(input);
            if (closed || detectors.has(value.ref))
                throw new Error('reminder-detector-unavailable');
            detectors.set(value.ref, value);
            return async () => {
                if (detectors.get(value.ref) !== value)
                    return;
                detectors.delete(value.ref);
                const affected = [...running.values()].filter(run => run.items.some(item => item.rule.judge?.ref === value.ref));
                for (const run of affected)
                    run.controller.abort(new Error('reminder-detector-disposed'));
                await Promise.allSettled(affected.map(run => run.task));
            };
        },
        registerAnalyzer(input) {
            if (!input || typeof input !== 'object' || Array.isArray(input))
                throw new TypeError('reminder-analyzer-requires-object');
            const value = Detector.parse({ exportName: 'analyze', ...input });
            if (closed || analyzers.has(value.ref) || ['__proto__', 'constructor', 'prototype'].includes(value.ref))
                throw new Error('reminder-analyzer-unavailable');
            analyzers.set(value.ref, value);
            return async () => {
                if (analyzers.get(value.ref) !== value)
                    return;
                analyzers.delete(value.ref);
                const affected = [...running.values()].filter(run => run.analyzers.includes(value));
                for (const run of affected)
                    run.controller.abort(new Error('reminder-analyzer-disposed'));
                await Promise.allSettled(affected.map(run => run.task));
            };
        },
        /** Resolve current recipient facts before presenting the applicable rules. */
        async catalog(sessionId, agentPreset) {
            const target = await identity(sessionId, agentPreset);
            return catalogFor(item => sourceAccepts(item, target), rule => ruleAccepts(rule, target));
        },
        /** Synchronous action definitions for policy lookup; delivery and UI use catalog/recipient checks. */
        controlCatalog(sessionId) {
            return catalogFor(item => item.value.sessionId === undefined || item.value.sessionId === sessionId, () => true);
        },
        submit(rawEvent, signal) { return admit(rawEvent, signal); },
        /** Evaluate denial policy before a tool body runs; the guard later reads this ticket. */
        async prepareToolExecution({ key, sessionId, agentPreset, name, arguments: args, callId, rootCallId, signal }) {
            if (closed)
                return;
            const pre = openPreExecution(key, tickets);
            const before = [...sources.values()].flatMap(item => item.compiled.filter(rule => rule.on === 'tool.before-execute'));
            // 只有 deny-tool 能改变行为。纯提醒规则即使挂在执行前，也不得拦住这次调用：
            // 先把票据结为放行，再照常评估投递——提醒晚一拍没有代价，卡住工具却有很大代价。
            if (!before.some(rule => rule.effect.kind === 'deny-tool'))
                pre.settle(undefined, true);
            // 一条执行前规则都没有时无需评估。
            if (!before.length)
                return;
            await admit(Event.parse(jsonCopy({ type: 'tool.before-execute', sessionId, ...(agentPreset === undefined ? {} : { agentPreset }),
                callId, rootCallId, name, arguments: args, clock: { at: wallNow() }, facts: {} })), signal, pre).catch(report);
        },
        /**
         * Declare the custom events a rule may select by name. The owner keeps the returned
         * disposer inside a Cordis effect, so unloading that plugin withdraws its names:
         * nothing can publish them afterwards, and `handlesSessionEvent` reports them as
         * unreachable even though already-compiled rules still mention them.
         */
        registerCustomEvents(descriptors) {
            if (closed)
                throw new Error('reminder-runtime-closed');
            const added = [];
            for (const descriptor of descriptors) {
                const name = descriptor.name;
                if (typeof name !== 'string' || !name.trim())
                    throw new Error('自定义事件名不能为空');
                if (BUILT_IN_EVENT_NAMES.has(name))
                    throw new Error(`自定义事件不能占用内置事件名 ${name}`);
                const shape = descriptor.shape ?? 'any';
                const existing = customEvents.get(name);
                // Re-declaring the same name with the same shape is what a plugin reload looks
                // like; a different shape would leave already-compiled selectors unverified.
                if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(shape)) {
                    throw new Error(`自定义事件 ${name} 已被声明为另一种载荷结构`);
                }
                if (existing === undefined) {
                    customEvents.set(name, shape);
                    added.push(name);
                }
            }
            return () => { for (const name of added)
                customEvents.delete(name); };
        },
        /**
         * Publish one custom event. `eventId` is the idempotency key: care records it in the
         * session's durable state, so re-publishing is ignored instead of delivered twice.
         * The payload rides `arguments` and is frozen into the delivery evidence as received.
         */
        async publishCustomEvent({ sessionId, name, eventId, at, facts }, signal) {
            if (closed)
                throw new Error('reminder-runtime-closed');
            if (!customEvents.has(name))
                throw new Error(`自定义事件 ${name} 未被声明`);
            if (!eventId.trim())
                throw new Error('自定义事件缺少幂等键 eventId');
            await admit(Event.parse(jsonCopy({ type: 'session.event', sessionId, name, arguments: facts,
                callId: eventId, rootCallId: eventId, clock: { at: at ?? wallNow() }, facts: {} })), signal).catch(report);
        },
        /**
         * Whether any registered rule selects this committed DSH event type. A session
         * event can only match a rule whose `eventType` equals it, so this pre-filter is
         * exact and keeps unrelated log traffic off the admission path.
         */
        handlesSessionEvent(eventType) {
            // A withdrawn custom name has no producer left, so nothing can reach the rules that
            // still reference it; a built-in name always can.
            if (!BUILT_IN_EVENT_NAMES.has(eventType) && !customEvents.has(eventType))
                return false;
            for (const source of sources.values()) {
                for (const rule of source.compiled) {
                    if (rule.on === 'session.event' && rule.when.eventType === eventType)
                        return true;
                }
            }
            return false;
        },
        /** Synchronous guard decision; never awaits, so another listener cannot re-allow a denial. */
        decideToolExecution(key) { return tickets.decide(key, now()); },
        /** Release a settled execution's ticket. */
        settleToolExecution(key) { tickets.settle(key); },
        async settle(sessionId) {
            // Previous callers have already received write failures. A new collection may retry the durable writer.
            await Promise.allSettled([...admissions].filter(item => item.sessionId === sessionId).map(item => item.task));
            await chains.get(sessionId)?.catch(() => { });
            await Promise.all([running.get(sessionId)?.done, ...(queues.get(sessionId) ?? []).map(run => run.done)]);
            await chains.get(sessionId)?.catch(() => { });
        },
        snapshot(sessionId) { return structuredClone({ ...(records.get(sessionId) ?? empty()), sources: [...sources.values()].map(item => item.value), storageError: failures.has(sessionId) }); },
        async collect({ sessionId, agentPreset, visible, accepted = [], committedIds = [], signal, candidateIds }) {
            await this.settle(sessionId);
            signal?.throwIfAborted();
            const reserved = [];
            return update(sessionId, async (state) => {
                const messages = [], present = [...visible, ...accepted];
                const keys = new Set(present.flatMap(reminderKeys));
                // Accepted inbox entries are not committed yet; pre-step filtering still owns their handoff.
                const committed = new Set([...committedIds, ...visible.map(message => message.id)]);
                // The human-turn clock advances only on a new human message, not on every request.
                let lastHumanId = '';
                for (const message of present)
                    if (message.source?.kind === 'user' && message.id !== undefined)
                        lastHumanId = message.id;
                const humanId = lastHumanId;
                const consume = [];
                for (const candidate of state.candidates) {
                    if (candidate.status !== 'reserved')
                        continue;
                    if (!candidate.messageId)
                        throw new Error('reminder-reservation-identity-missing');
                    if (committed.has(candidate.messageId)) {
                        candidate.status = 'delivered';
                        if (quotaFor(candidate))
                            consume.push(candidate.messageId);
                        // Only a confirmed delivery spends a lifetime unit, so a dropped tick is retried.
                        const activation = candidate.sticky
                            ? state.stickies.find(item => item.activationId === candidate.sticky?.activationId) : undefined;
                        if (activation)
                            activation.remaining = Math.max(0, activation.remaining - 1);
                        // The first confirmed delivery opens one activation; later ticks reuse its text.
                        const sticky = candidate.rule.effect.deliver.model.sticky;
                        if (sticky && !candidate.sticky && !state.stickies.some(item => item.activationId === candidate.id)) {
                            state.stickies.push({ key: JSON.stringify([candidate.sourceId, candidate.ruleId, candidate.id]),
                                activationId: candidate.id, sourceId: candidate.sourceId, ruleId: candidate.ruleId, sessionId,
                                text: candidate.text, title: candidate.title, clock: sticky.clock,
                                remaining: sticky.lifetime - 1, cooldown: sticky.cooldown,
                                charged: quotaFor(candidate) !== undefined, lastHumanId: humanId });
                        }
                    }
                    else
                        keys.add(candidate.key); // Unknown handoff cannot be retried merely because the process restarted.
                }
                if (consume.length)
                    await claims({ consume });
                const ticked = advanceStickies(state, humanId);
                pendSticky(state, sessionId, ticked);
                for (const candidate of state.candidates) {
                    if (candidate.status !== 'pending' || (candidateIds && !candidateIds.includes(candidate.id)))
                        continue;
                    // A persisted rollback keeps its old message id until shared release is acknowledged.
                    // A later sticky tick never reserved a quota, so it has nothing to release.
                    if (candidate.messageId && !candidate.sticky?.charged && quotaFor(candidate)) {
                        await claims({ release: [candidate.messageId] });
                        delete candidate.messageId;
                    }
                    const target = await identity(sessionId, agentPreset, signal);
                    if (closed || !fresh(candidate) || !current(candidate, target) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
                        || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) {
                        candidate.status = 'discarded';
                        continue;
                    }
                    if (keys.has(candidate.key) || state.windows.some(item => item.key === candidate.key)) {
                        candidate.status = 'discarded';
                        continue;
                    }
                    // The reminder is already present during an activation, so a repeated hit is
                    // absorbed: it must neither deliver again nor extend the activation.
                    if (!candidate.sticky && state.stickies.some(item => item.sourceId === candidate.sourceId && item.ruleId === candidate.ruleId)) {
                        candidate.status = 'discarded';
                        continue;
                    }
                    // The template renders once, against the facts frozen when the rule matched.
                    // A sticky activation later reuses this same text instead of rendering again.
                    if (!candidate.rendered) {
                        try {
                            candidate.text = renderText(candidate.rule.text, candidate.evidence);
                            candidate.rendered = true;
                        }
                        catch (error) {
                            candidate.status = 'discarded';
                            state.diagnostics.push(AnalysisFacts.parse(jsonCopy({ at: wallNow(), ruleId: candidate.ruleId,
                                sourceId: candidate.sourceId, eventId: candidate.eventId, status: 'render-failed',
                                message: errorMessage(error) })));
                            continue;
                        }
                    }
                    // An activation charges its shared quota once, when it opens.
                    const messageId = randomUUID(), quota = candidate.sticky?.charged ? undefined : quotaFor(candidate);
                    if (quota) {
                        const book = await claims({ reserve: [{ ...quota, candidateId: candidate.id, sessionId, messageId }] });
                        // Losing sessions retain a pending hit: a known rollback may make room on their next request.
                        if (!hasClaim(book, quota.key, messageId))
                            continue;
                        reserved.push(messageId);
                        // A model/preset/source switch while the shared slot is being saved must release the slot.
                        const latest = await identity(sessionId, agentPreset, signal);
                        if (closed || !fresh(candidate) || !current(candidate, latest) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
                            || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy) {
                            await claims({ release: [messageId] });
                            candidate.status = 'discarded';
                            continue;
                        }
                    }
                    signal?.throwIfAborted();
                    keys.add(candidate.key);
                    candidate.messageId = messageId;
                    candidate.status = 'reserved';
                    if (candidate.window && candidate.rule.effect.kind === 'remind' && candidate.rule.effect.deliver.model.once === 'window')
                        state.windows.push({ key: candidate.key, until: candidate.window.end, messageId });
                    messages.push(reminderMessage(candidate, messageId));
                }
                return messages;
            }, async () => { if (reserved.length)
                await claims({ release: reserved }); });
        },
        async rollback(sessionId, messages) {
            const ids = new Set(messages.filter(message => message.source?.kind === REMINDER_MESSAGE_KIND).map(message => message.id));
            if (!ids.size)
                return;
            const release = await update(sessionId, state => {
                const release = [];
                for (const candidate of state.candidates) {
                    if (!candidate.messageId || !['reserved', 'pending'].includes(candidate.status) || !ids.has(candidate.messageId))
                        continue;
                    // An explicit snooze has no messageId and survives cancellation of this handoff.
                    state.windows = state.windows.filter(item => item.messageId !== candidate.messageId);
                    candidate.status = 'pending';
                    if (quotaFor(candidate))
                        release.push(candidate.messageId);
                    else
                        delete candidate.messageId;
                }
                return release;
            });
            if (release.length)
                await claims({ release });
        },
        async filterMessages(sessionId, visible, messages, agentPreset) {
            if (!messages.some(message => message.source?.kind === REMINDER_MESSAGE_KIND))
                return messages;
            const target = await identity(sessionId, agentPreset);
            const keys = new Set(visible.flatMap(reminderKeys));
            const state = records.get(sessionId);
            return messages.filter(message => {
                if (message.source?.kind !== REMINDER_MESSAGE_KIND)
                    return true;
                const candidate = state?.candidates.find(item => item.messageId === message.id);
                if (closed || !state || !candidate || candidate.status !== 'reserved' || !fresh(candidate) || !current(candidate, target) || keys.has(candidate.key)
                    || state.windows?.some(item => item.key === candidate.key && item.messageId !== message.id) || !eligible(sessionId, candidate.sourceId, candidate.ruleId)
                    || epoch(sessionId, candidate.sourceId, candidate.ruleId) !== candidate.policy)
                    return false;
                keys.add(candidate.key);
                return true;
            });
        },
        async close() {
            closed = true;
            for (const admission of admissions)
                admission.controller.abort(new Error('reminder-runtime-closed'));
            for (const queue of queues.values())
                for (const run of queue) {
                    clearTimeout(run.timer);
                    run.resolve();
                }
            queues.clear();
            for (const run of running.values())
                run.controller.abort(new Error('reminder-runtime-closed'));
            await Promise.allSettled([...running.values()].map(run => run.done));
            await Promise.allSettled([...admissions].map(item => item.task));
            // 写回策略把落盘推迟了，关闭前必须把待写的快照交出去：
            // 那些快照就是内存里的最终状态，丢掉等于真丢数据。
            // 待写的（dirty）和正在写的（flushing）都要等：只等其中一边，
            // 另一边就会在 close 返回之后继续往盘上写。
            const owed = new Set([...dirty.keys(), ...flushing.keys()]);
            // 写者是按顺序排空的：一次慢写没完，后面的快照都在等它。
            // 关窗只给一个 storageTimeoutMs 的话，盘只要比这个窗口稍慢，
            // close 就会在最后一份快照落地前撒手——而那正是内存里的最终状态。
            // 所以这里给两个窗口：足够排空一次慢写加它后面那份。
            const closeWaitMs = config.storageTimeoutMs * 2;
            await Promise.allSettled([...owed].map(id => {
                const writing = flushing.get(id) ?? flush(id).finally(() => flushing.delete(id));
                return Promise.race([writing,
                    new Promise(resolve => { const timer = setTimeout(resolve, closeWaitMs); timer.unref?.(); })]);
            }));
            dirty.clear();
            flushing.clear();
            await Promise.allSettled([...chains.values(), capacityWrite]);
            sources.clear();
            detectors.clear();
            analyzers.clear();
            rejectedSources.clear();
            tickets.dispose();
        },
    };
}
//# sourceMappingURL=runtime.js.map