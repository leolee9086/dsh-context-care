import { z } from 'zod'
import { createUserMessage } from './message.js'
import { producedBy, producerKind } from './producer-source.js'
import { calculateState, GUIDANCE, renderState, resolveConfig } from './policy.js'
import { createMaintenanceController, pruneThenMeasure } from './maintenance-policy.js'
import { contextBudget, budgetPolicy } from './context-budget.js'
import { recoveryProof } from './recovery-proof.js'
import { captureInputPricing } from './input-pricing.js'
import { createSummaryExecutor } from './summary-executor.js'
import { repairSummaryImages } from './image-repair.js'
import { runMaintenance } from './maintenance-journal.js'
import { createMaintenanceOperations } from './maintenance-operations.js'
import { ScopedPromptConfig, selectScopedPrompts } from './scoped-prompts.js'
import { contextCareProjection } from './projection.js'
import { selectClearRange, selectRestRange, selectMaintenanceRange } from './selection.js'
import { createProposalExecutor } from './summary-proposals.js'
import { maintenancePassLimit } from './summary-request.js'
import { clearRange } from './deep-rest.js'
import { alreadyWarned, detectLoop, loopNeedsReminder, loopNoticeText } from './loop-guard.js'
import { createStreamWatch } from './stream-watch.js'
import { installNoticeRules } from './notice-rules.js'
import { NOTICE_CHANNEL, sharedNoticeChannel } from './notice-channel.js'
import { lastAssistantMessage, lastAssistantText, lastUserMessage, textOf } from './prompt-text.js'
import { createRequestRewriter, REWRITER_NAME } from './request-rewrite.js'
import { createTransformLog } from './transform-log.js'
import { createRewriteJournal } from './rewrite-journal.js'

export const name = 'dsh-context-care'
export const inject = ['agents', 'sessions', 'tools', 'systemPrompt', 'tokenMeter', 'llm', 'compaction', 'sessionProjections', 'contextCareRequests']
// Standard Schema is consumed by Cordis before activation; no DSH schema helper.
export const Config = z.object({
  budgetRatio: z.number().optional(), wakefulnessRatio: z.number().optional(),
  fatigueExponent: z.number().optional(), retainRatio: z.number().optional(),
  rangeStrategy: z.enum(['basic-prefix', 'target-prefix']).optional(), expectedCheckpointTokens: z.number().int().nonnegative().optional(),
  minFreshTokens: z.number().int().optional(), minNoteChars: z.number().int().optional(), maxNoteChars: z.number().int().optional(),
  providerUsageRatio: z.number().optional(),
  softBudgetRatio: z.number().optional(), hardBudgetRatio: z.number().optional(),
  hysteresisRatio: z.number().optional(), maxPasses: z.number().int().optional(),
  auxiliaryBudgetRatio: z.number().optional(),
  modelScopedPrompts: z.array(ScopedPromptConfig).optional(),
  maxSummaryRepairRetries: z.number().int().nonnegative().optional(), maxSummaryCallsPerAction: z.number().int().positive().optional(),
  summary: z.object({ provider: z.string().min(1).optional(), model: z.string().min(1).optional(),
    maxTokens: z.number().int().positive().optional(), maxRetries: z.number().int().nonnegative().optional() }).strict().optional(),
  safetyTokens: z.number().int().nonnegative().optional(), burstTokens: z.number().int().nonnegative().optional(),
  releaseMarginTokens: z.number().int().nonnegative().optional(), summarySafetyTokens: z.number().int().nonnegative().optional(),
  maxOverflowRetries: z.number().int().nonnegative().optional(), retainTokens: z.number().int().nonnegative().optional(),
  contextBudgetTokens: z.number().int().positive().optional(), billingInputCeilingTokens: z.number().int().positive().optional(),
  routeBudgets: z.array(z.object({ provider: z.string().min(1), model: z.string().min(1), purpose: z.enum(['conversation', 'compaction', 'session-title']),
    contextBudgetTokens: z.number().int().positive().optional(), billingInputCeilingTokens: z.number().int().positive().optional() }).strict()).optional(),
}).strict().prefault({})

const requestPlugin = `${name}:request`
const statePlugin = `${name}:state`
const loopPlugin = `${name}:loop`
/** 每个流式模式一个独立的 plugin 标识 —— alreadyWarned 据此按模式去重。 */
const watchPlugin = triggerId => `${name}:watch:${triggerId}`

function notice(plugin, text, summary, state, extra) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: producerKind(plugin), form: 'notice', summary,
      ...(state ? { contextCare: { fatigueValue: state.fatigueValue, wakefulnessValue: state.wakefulnessValue } } : {}),
      ...extra,
    },
  })
}

/**
 * 时间规划提醒：词表命中只说明出现了相关措辞，不能判断任务有没有期限。
 * 真人给出的期限和已提供的时间可用于规划；未提供的运行额度仍应按未知处理。
 * Seraph 是所参考的 S-forge 提醒名称，不表示接入了心理医生服务。
 */
function timeAnxietyText() {
  return [
    '<context-care>',
    '[Seraph · 上下文照料提醒]',
    '',
    '如果正在规划时间与调用次数，请核对依据：',
    '真人明确给出的期限、当前时间和已知运行限制可以用于规划；未提供的剩余运行额度按未知处理。',
    '依据实际目标、工作进度和验证需求安排下一步；需要整理上下文时，保存交接并在合适的工作边界处理。',
    '</context-care>',
  ].join('\n')
}

/**
 * 上下文规划提醒，使用最近一次状态报告的估计，不据词表命中推断心理状态。
 * 流式广播同步读取 previousState；缺少数值时提示查询当前计量。
 */
function contextAnxietyText(state) {
  const measured = Number.isFinite(state?.fatigueValue) && Number.isFinite(state?.wakefulnessValue)
  return [
    '<context-care>',
    '[Seraph · 上下文照料提醒]',
    '',
    '如果你正在盘算上下文还剩多少，先看这个盘算的依据：',
    measured
      ? `上下文占用是有测量的——最近一次报告为 fatigue ${state.fatigueValue}%、wakefulness ${state.wakefulnessValue}%。`
      : '上下文占用是有测量的，随时可以调用 context_status 查看。',
    '这些指标是请求负载与留存信息量的估计。结合实际工作步骤、当前计量、交接和找回路径安排整理时机。',
    '压缩前把当前目标、已验证结果、未完成工作和关键路径记清；原始细节可从会话日志或检查点核对。',
    '维护完成后核对报告，再继续任务。',
    '</context-care>',
  ].join('\n')
}

/**
 * 每个模式命中后要说的话。模式只交证据，措辞在这里定 ——
 * 所以加一种检测方式时，要么复用已有文案，要么在这里加一行。
 */
export const WATCH_NOTICES = {
  'line-repeat': { summary: 'Output loop aborted', text: hit => loopNoticeText(hit, true) },
  'time-anxiety': { summary: 'Time planning reminder', text: () => timeAnxietyText() },
  // 上下文长度焦虑：文案要用最近一次状态报告里的数值给证据，所以接第二个参数。
  'context-anxiety': { summary: 'Context planning reminder', text: (_hit, state) => contextAnxietyText(state) },
}

/** Read only the latest retained state; no process-local state can leak across sessions. */
export function previousState(session) {
  for (let index = session.surface.nodes.length - 1; index >= 0; index--) {
    const event = session.eventAt(session.surface.nodes[index])
    if (event?.type === 'user/message' && producedBy(event.data.source, statePlugin)) {
      return {
        text: event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        fatigueValue: event.data.source.contextCare?.fatigueValue,
        wakefulnessValue: event.data.source.contextCare?.wakefulnessValue,
      }
    }
  }
  return undefined
}

/**
 * Notify only when the model-visible status or outcome changes.
 *
 * Numeric values live in source metadata for the UI; the model-facing text deliberately
 * contains only grades and guidance. A numeric-only change therefore adds no information
 * to the model, but it does append another user message and can make the status look like
 * a countdown. Keep the notification keyed to the text the model can actually read.
 */
export function shouldNotify(previous, text, _state) {
  return previous?.text !== text
}

/** Attach tools and durable boundary-time status, leaving the compaction provider unchanged. */
export function apply(ctx, raw = {}) {
  return installContextCare(ctx, raw, ctx.compaction)
}

/**
 * Shared installer. `compactionSource` is either the compaction provider itself
 * (the agent-scoped `/agent` entry, where the service is already scoped) or a
 * resolver `agent => provider | undefined` (the root entry, where the provider
 * differs per agent and is resolved at the boundary that uses it).
 */
/** 有限数原样返回,其它一律 null —— 表示"此刻不可知",不是 0。 */
function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 最后一个已开始的轮号;一个都没有时给 null。 */
function lastTurnNumber(session) {
  if (typeof session?.snapshotEvents !== 'function') return null
  let last
  for (const event of session.snapshotEvents()) {
    if (event?.type === 'turn/start' && Number.isFinite(event.data?.turn)) last = event.data.turn
  }
  return last ?? null
}

/**
 * 把这一轮的实测值摊成规则能用的指标。
 *
 * **键名是跨插件的契约**:写规则的插件按这些名字用 when.numbers。只增不改 ——
 * 改名等于改了契约,得先跟用它的人说。引擎不认识这些名字,它只按 key 取值比较。
 *
 * 算不出来的给 null(finiteOrNull),**不给 undefined**:后者会被引擎当成
 * "规则写错或调用方漏填"而抛错,连累同一批里别的规则。
 *
 * @param {object|undefined} current sample() 的结果。
 * @param {object} session 会话,用来数轮次。
 * @returns {object} 指标名 → 有限数或 null。
 */
function careFacts(current, session) {
  const state = current?.state ?? {}
  const measurement = current?.measurement
  return {
    fatigue: finiteOrNull(state.fatigueValue),
    wakefulness: finiteOrNull(state.wakefulnessValue),
    totalTokens: finiteOrNull(measurement?.totalTokens),
    surfaceTokens: finiteOrNull(measurement?.surfaceTokens),
    // 轮次跟时间无关,所以「聊了 N 轮还没记东西」这类判据在从没记过的会话上也成立 ——
    // 这正是 idle 那条规则漏掉的情况。
    turns: finiteOrNull(lastTurnNumber(session)),
  }
}
export function installContextCare(ctx, raw, compactionSource) {
  const resolveCompaction = typeof compactionSource === 'function' ? compactionSource : () => compactionSource
  const spec = resolveConfig(raw)
  const operations = createMaintenanceOperations()
  ctx.effect(() => () => operations.dispose())
  const compactSummary = createSummaryExecutor({ meter: ctx.tokenMeter, llm: ctx.llm, requests: ctx.contextCareRequests, spec,
    recover: payload => ctx.waterfall('compaction/summary-error', payload, () => false)
      || repairSummaryImages(ctx.sessions, payload) })
  const executeProposal = createProposalExecutor(ctx.contextCareRequests, compactSummary)
  const propose = (agent, current, allowFallback) => selectMaintenanceRange(agent.session, current.measurement, {
    // 容量未知只让压力预估不可用。主动请求仍可按显式尾部设置选区，
    // 缺省保留最近完整单元，再由摘要路由或自定义 provider 处理实际输入。
    retainTokens: current.budget?.retainTail ?? spec.retainTokens ?? 0, minFreshTokens: spec.minFreshTokens, pluginName: name,
    deficitTokens: current.loadTokens === undefined || current.budget?.releaseTarget === undefined
      ? 0 : Math.max(0, current.loadTokens - current.budget.releaseTarget), rangeStrategy: spec.rangeStrategy,
    expectedCheckpointTokens: spec.expectedCheckpointTokens, allowFallback,
  })
  const maintain = (session, pricing, action, reason, run) => runMaintenance({ requests: ctx.contextCareRequests, session, pricing, action, reason, run })
  const prune = (agent, pricing, reason) => {
    const pruner = resolvePruner(agent)
    return pruner === undefined ? undefined : { pruneSession: session => maintain(session, pricing, 'prune', reason, () => pruner.pruneSession(session)) }
  }
  if (typeof ctx.tokenMeter.measureInput !== 'function' || typeof ctx.tokenMeter.priceMessages !== 'function') {
    throw new Error('context-care requires input-only tokenMeter.measureInput and priceMessages; update the Host')
  }
  if (raw?.providerUsageRatio !== undefined) ctx.logger.warn('context-care: providerUsageRatio is deprecated; tokenMeter owns input calibration')
  // This gate is the only automatic maintenance decision in context-care. The
  // Basic backend is configured with auto:false in the authored composition so
  // it remains an executor for explicit requests, never a second controller.
  const maintenanceBySession = new WeakMap()
  function maintenanceFor(session) {
    let controller = maintenanceBySession.get(session)
    if (controller === undefined) {
      controller = createMaintenanceController({
        softBudgetRatio: spec.softBudgetRatio,
        hardBudgetRatio: spec.hardBudgetRatio,
        hysteresisRatio: spec.hysteresisRatio,
        maxPasses: spec.maxPasses,
        auxiliaryBudgetRatio: spec.auxiliaryBudgetRatio,
      })
      maintenanceBySession.set(session, controller)
    }
    return controller
  }
  const resolvePruner = agent => ctx.get('agentPresets')?.serviceFor(agent, 'toolResultPruner') ?? ctx.get('toolResultPruner')
  ctx.effect(() => ctx.sessionProjections.register(contextCareProjection))
  ctx.effect(() => ctx.systemPrompt.context({ name, order: 90, text: GUIDANCE }))

  // ---------------------------------------------------------- 提示规则
  //
  // 规则由别的插件声明(索引插件的 memoryNoticeRules 服务),本插件是它的消费者:
  // 判断什么时候该提醒、提醒什么,都在这里发生。规则本身不属于本插件。
  // ---------------------------------------------------------- 变换记录
  //
  // 写进会话日志的 log-only 事件:模型看不到,但持久、可回放、能推给界面。
  // 为什么这么做见 transform-log.js 的头注释。
  const transformLog = createTransformLog({ ctx })
  // 改写记录:会话日志之外的旁路。索引插件的属性表在就落它那里(持久、可与块索引 JOIN),
  // 不在就只在进程内。服务名是索引插件自己的,这里现取 —— 它可能晚于本插件注册。
  const rewriteJournal = createRewriteJournal({
    store: () => ctx.get('sessionBlockQuery'),
    warn: message => ctx.logger.warn(message),
  })
  /** 两个来源的命中都记到一处,面板和排查都只看这一张表。 */
  const recordHit = (layer, record, where) => transformLog.record({
    sessionId: where.sessionId,
    layer,
    ruleId: record.ruleId,
    outcome: record.outcome,
    loss: record.loss,
    detail: record.detail,
  })

  const noticeRules = installNoticeRules(ctx, {
    plugin: name,
    onHit: (record, where) => recordHit('notice', record, where),
  })

  // ---------------------------------------------------------- 通知通道
  //
  // 通用通道:别的插件有话要告诉模型时,注册一个源;这里在每个请求边界问一遍。
  // 通道不认识「召回」「分数」这些东西 —— 它只知道要通知什么、什么时候能通知。
  const noticeChannel = sharedNoticeChannel({ warn: message => ctx.logger.warn(message) })
  // 两个入口都会跑到这里,而服务名只有一个 —— 已经有了就不再注册。
  // 注册两次会让插件的 agent 行挂载失败(见 notice-channel.js 里的报错原文)。
  if (ctx.get(NOTICE_CHANNEL) === undefined) {
    ctx.provide(NOTICE_CHANNEL, { register: noticeChannel.register })
  }

  // ---------------------------------------------------------- 循环清理
  //
  // 输出循环的清理改在**请求层**执行(2026-09-23):执行点就是下面 requestRewrite
  // 登记的那个改写器 —— 请求体里就是完整 messages,上一轮助手输出在里面,
  // 这正是 pre-step 够不着的部分。清理不写任何会话事件:
  // 自定义事件被 DSH 读侧校验否决(重启拒载),而且清理本来也不需要事件 ——
  // 它只是"这一次不把循环发出去",日志原文不动。
  // 判定逻辑在 loop-clean.js(模式表);loop-clean-projection.js 的 pendingLoopClean
  // 保留但已不再被引用;投影注册不再需要 —— 投影靠决策事件驱动,没有事件就没载体。

  // ---------------------------------------------------------- 请求层篡改
  //
  // 篡改的执行在请求层,那里看得见整段组装好的请求体。执行者由别的插件提供
  // (fetch-router 的 requestRewrite 服务);没装就没有执行者,篡改规则不生效,
  // 引擎会在 gate 阶段判掉并留下 no-consumer 记录 —— 请求保持原样。
  // 清理执行者在不在：严重档的兜底提醒要用它（见 loop-guard.js 的 loopNeedsReminder）——
  // fetch-router 没装或没启用时这段 inject 不会跑，严重循环就清不掉，那就必须提醒，
  // 不能既不清也不说。
  let cleanupActive = false
  ctx.inject(['requestRewrite'], (scope) => {
    const rewrite = createRequestRewriter({
      // 跟提醒规则共用一个服务:规则里用 placement 区分它该在哪一层生效。
      rules: () => {
        const rules = ctx.get('memoryNoticeRules')
        return rules === undefined || rules === null ? [] : rules
      },
      // 改写记录必须交给改写器,否则被改过的文本在界面上看不出来 ——
      // 卡片认的是内容哈希,哈希只有改写器算得出来。
      journal: rewriteJournal,
      onRecord(record, where) {
        recordHit('request', record, where)
        if (record.outcome !== 'applied') {
          ctx.logger.warn(`context-care: 请求层规则 ${record.ruleId} 未生效(${record.outcome})${record.detail === undefined ? '' : ': ' + record.detail}`)
          return
        }
        ctx.logger.info(`context-care: 请求层改写 ${record.ruleId},废掉 ${(record.loss * 100).toFixed(2)}% 缓存`)
      },
    })
    const dispose = scope.requestRewrite.register(REWRITER_NAME, rewrite)
    cleanupActive = true
    ctx.effect(() => () => { cleanupActive = false })
    return dispose
  })

  // ---------------------------------------------------------- 流式监视
  //
  // 「检测模式 → 执行操作」两段式：stream-watch 只管维护视图和调度，
  // 判定由模式（DETECTORS）负责，行为由下面的 actions 表负责。这里不认识"循环"。
  //
  // 与下面 pre-step 那条事后路径的分工：
  //   · 流式路径抢在生成过程中动手，命中的那一轮当场掐断，不会再刷屏；
  //   · pre-step 路径是兜底 —— 阈值没到、或者哪个模式没命中，下一个请求边界仍会提醒一次。
  // 两条路共用同一份文案；窗口参数共用 stream-watch 的常量，只有阈值不同：
  // 掐断宁可漏也不误杀（长清单、代码、表格都可能出现稀疏重复）。
  const abortCounts = new Map()
  /** 连着掐断这么多次就不再自动续，把控制权交回人。 */
  const MAX_AUTO_RESUME = 1
  /** 已提醒过的 (会话, 模式)；用户一说话就清空，所以下一轮真的再犯还会提醒。 */
  const noticeSent = new Set()

  const streamWatch = createStreamWatch({
    triggers: [
      {
        id: 'line-repeat',
        kind: 'line-repeat',
        scope: 'combined',
        everyBytes: 300,
        minLines: 30,
        minCount: 30,
        minRatio: 0.35,
        minRun: 12,
        actions: ['abort', 'resume'],
      },
      {
        // 时间焦虑：只认思考块 —— 正文里讨论「时间成本」是正常讨论。
        // 词表刻意避开「尽快」「赶紧」这类泛词：它们在正常的任务描述里太常见，会误杀。
        id: 'time-anxiety',
        kind: 'phrase',
        scope: 'reasoning',
        phrases: [
          '时间不够', '时间有限', '时间不多', '时间紧迫', '没时间了', '来不及',
          '加快速度', '得加快', '抓紧时间', '节省时间', '浪费时间', '太耗时', '时间成本',
        ],
        // 只提醒，不掐断：时间焦虑不会毁掉这一轮的产出，掐断反而会打断本来正确的作答。
        // 需要中止的是循环 —— 那种输出会一直刷到把整屏烧完。
        actions: ['notice'],
      },
      {
        // 上下文长度焦虑：同样只认思考块 —— 正文里讨论上下文占用、压缩策略是正常工作。
        //
        // 词表只收**把资源当威胁**的表述，不收**把资源当工具**的表述：
        //   · 盘算余量（上下文不够 / 快满 / 压力 / 成本）—— 跟"时间不够"对称；
        //   · "抢在某个事件之前"的结构（趁还没压缩 / 免得被压缩）。
        // 刻意**不**收「该压缩了」这类 —— 主动压缩是健康行为，把工具当工具用不该被监控，
        // 把工具当成要躲的事件才该。判据是施动者：我是施动者就正常，压缩成了施动者才是歪曲。
        id: 'context-anxiety',
        kind: 'phrase',
        scope: 'reasoning',
        phrases: [
          '上下文不够', '上下文有限', '上下文不多', '上下文快满', '上下文紧张', '上下文吃紧',
          '上下文压力', '上下文成本', '节省上下文', '省点上下文', '会话太长',
          '趁还没压缩', '趁压缩之前', '趁上下文还够', '免得被压缩',
        ],
        // 只提醒，不掐断：跟时间焦虑同理，它不会毁掉这一轮的产出。
        actions: ['notice'],
      },
    ],
    actions: {
      /**
       * 只提醒，不打断：把话注入下一步，让模型自己纠正。
       * 适合「这一轮本身没坏、只是念头跑偏」的情况。
       */
      notice({ agent, trigger, hit }) {
        const wording = WATCH_NOTICES[trigger.id]
        if (wording === undefined) return
        const key = `${String(agent.id)}:${trigger.id}`
        // 同一个用户回合里只提醒一次。这里**不能**扫 surface 判断：提醒的后面紧跟着那条
        // 运行时上下文（疲劳度/唤醒值），它也是 user 消息，扫描到的永远是它。
        // 所以自己记账，等用户说话时清空（见下面的 pre-step）。
        if (noticeSent.has(key)) return
        noticeSent.add(key)
        // 文案可能需要最近一次状态报告里的数值（上下文焦虑用它给证据）。
        // previousState 只扫 surface 尾部、是同步的；这里不能 await sample()。
        const state = agent.session === undefined ? undefined : previousState(agent.session)
        agent.inject(notice(watchPlugin(trigger.id), wording.text(hit, state), wording.summary))
      },
      /** 掐断这一轮。已生成的部分由 agent-loop 自己落成 interrupted 消息，不会静默丢。 */
      abort({ agent, hit }) {
        const key = String(agent.id)
        abortCounts.set(key, (abortCounts.get(key) ?? 0) + 1)
        agent.cancel({ kind: 'hook', reason: `output loop: ${hit.line}` }, { keepInbox: true })
      },
      /**
       * 唤醒并说明原因。
       *
       * 顺序必须在 abort 之后：cancel 让当前活动变成 aborted，这条 steer 才会被分类成
       * next-turn 并置上 wakeRequested，driver 收敛后才会开新 turn 把消息交给模型。
       * 反过来先 steer 再 cancel 是白干 —— 消息会躺在 inbox 里没人读。
       *
       * UI 只显示一个「已停止」、不显示原因，所以原因得由这条消息自己说清楚。
       */
      resume({ agent, trigger, hit }) {
        const key = String(agent.id)
        if ((abortCounts.get(key) ?? 0) > MAX_AUTO_RESUME) return
        const wording = WATCH_NOTICES[trigger.id]
        if (wording === undefined) return
        agent.steer(notice(watchPlugin(trigger.id), wording.text(hit), wording.summary))
      },
    },
    onError(error, context) {
      ctx.logger.warn(`context-care: stream-watch ${context}: ${error instanceof Error ? error.message : String(error)}`)
    },
  })

  ctx.effect(() => ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    // 一个会话只由一个实现监视。预设里挂了 `/agent` 入口时，作用域注册会遮蔽全局注册，
    // 根实现必须退让 —— 否则两个实例各注入一条一模一样的提醒。pre-step 那条路早就有这个
    // 退让，流式这条路一开始漏了，实测出来的现象就是「每次命中都收到两条」。
    if (typeof ctx.tools.get === 'function') {
      const visible = ctx.tools.get('context_rest', agent)
      if (visible !== undefined && visible !== contextRestTool) return
    }
    streamWatch.observe(agent, frame)
  }))

  // ------------------------------------------------------ 思考档位降档
  //
  // 【暂未启用，整段注释】哥哥的诊断：DeepSeek V4 Flash 开 max 思考时容易进输出循环，
  // 压缩 + 切 high 聊几轮就能恢复。所以循环被掐断之后，接下来几轮应该临时降档。
  //
  // 先注释掉的原因：`agent/request` 是 waterfall，返回改过的 LlmCallConfig，
  // 但**还没实测**它会不会被后面的 resolveCallConfig 覆盖。验证通过再启用。
  // 另外 call-config.ts 的注释写明 reasoningEffort 属于 request-header 状态，
  // 改它会让这次请求的 header 快照变化、缓存复用断一次 —— 所以只在真掐断过之后才动它。
  //
  // const downgrades = new Map()
  // /** 降到哪一档，以及维持几轮。 */
  // const DOWNGRADE_TO = 'high'
  // const DOWNGRADE_ROUNDS = 3
  //
  // // abort 里登记：downgrades.set(key, { to: DOWNGRADE_TO, remaining: DOWNGRADE_ROUNDS })
  // ctx.effect(() => ctx.on('agent/request', async ({ agent }, next) => {
  //   const config = await next()
  //   const key = String(agent.id)
  //   const pending = downgrades.get(key)
  //   if (pending === undefined || config.reasoningEffort === undefined) return config
  //   if (pending.remaining <= 0) {
  //     downgrades.delete(key)
  //     return config
  //   }
  //   // 当前档位已经不是我们设的那个，说明用户或别的插件改过 —— 以他们为准，放弃恢复。
  //   if (pending.expected !== undefined && config.reasoningEffort !== pending.expected) {
  //     downgrades.delete(key)
  //     return config
  //   }
  //   pending.remaining -= 1
  //   pending.expected = pending.to
  //   return { ...config, reasoningEffort: pending.to }
  // }))

  async function sample(agent, signal, proposed = [], includeState = false, operation) {
    signal.throwIfAborted()
    const pricing = operation ?? captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, requests: ctx.contextCareRequests })
    const measurement = pricing.measure()
    const config = pricing.pricingBasis.header?.config
    // The first envelope has no routed capacity; final dispatch owns its check.
    if (!config?.provider || !config.model) return { state: { fatigue: 'unknown', fatigueValue: null, wakefulness: 'unknown', wakefulnessValue: null }, measurement }
    const info = await ctx.llm.resolveModelInfo(config.provider, config.model, signal)
    signal.throwIfAborted()
    const physicalCapacity = info.context?.contextWindow
    const policy = budgetPolicy(spec, config)
    const incoming = pricing.priceMessages(proposed)
    // Output accounting is diagnostic only. The meter owns text calibration,
    // including large valid ratios; pending inputs use that same frozen basis.
    const retained = measurement.surfaceTokens
    const baseRequest = { ...config, purpose: 'conversation', messages: [...agent.session.deriveMessages(), ...proposed],
      tools: pricing.pricingBasis.header?.tools }
    const preview = ctx.contextCareRequests.preview?.(agent.session, baseRequest).request ?? baseRequest
    const promptCost = pricing.priceRequest(preview) - pricing.priceRequest(baseRequest)
    let load = Math.ceil(measurement.inputTokens + incoming + promptCost)
    if (includeState) {
      const capacity = Math.min(...[physicalCapacity, policy.contextBudgetTokens].filter(value => value !== undefined))
      const state = calculateState(load, retained, Number.isFinite(capacity) ? capacity : undefined, spec)
      const text = renderState(state)
      if (shouldNotify(previousState(agent.session), text, state)) load = Math.ceil(load + pricing.priceMessages([notice(statePlugin, text, 'Context state', state)]))
    }
    const budget = contextBudget({ inputTokens: load, physicalCapacity, policyCapacity: policy.contextBudgetTokens,
      billingInputCeilingTokens: policy.billingInputCeilingTokens, maxTokens: config.maxTokens, defaultMaxTokens: info.defaultMaxTokens,
      safetyTokens: spec.safetyTokens, burstTokens: spec.burstTokens, releaseMarginTokens: spec.releaseMarginTokens,
      softRatio: spec.budgetRatio, retainRatio: spec.retainRatio, retainTokens: spec.retainTokens })
    return {
      state: calculateState(load, retained, budget.capacity, spec),
      measurement,
      budget,
      capacity: budget.capacity,
      loadTokens: load,
    }
  }

  const contextStatusTool = {
    name: 'context_status',
    description: '读取实测的上下文疲劳度与唤醒值。这些是估计，不是记忆丢失的诊断，也不是任务的截止时间。用来判断一次检查点有没有用；不要反复轮询。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(args, exec) {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('context_status 只接受一个空对象')
      if (!exec.agent) throw new Error('context_status 需要一个所属会话')
      const { state } = await sample(exec.agent, exec.signal)
      return renderState(state)
    },
    presentCall: () => ({ card: 'generic', title: 'Context state', kind: 'read' }),
  }

  const contextRestTool = {
    name: 'context_rest',
    description: '在下一个安全的请求边界请求一次历史压缩，即使还没到自动压力阈值。给一段交接笔记（宜细不宜粗）；近况和这条笔记会留下来。这只是排定压缩，不会删除文件、不会结束任务，也不是睡眠计时器。按报告出来的结果继续。deep 为真时历史是被清空而不是被摘要，只剩笔记和找回路径。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['note'],
      properties: {
        // 下限不是防呆，是**要求写细**：几百字的笔记下一个自己还得回去翻日志。
        note: { type: 'string', minLength: spec.minNoteChars, maxLength: spec.maxNoteChars, description: `交接笔记：当前目标、已验证的进度、没做完的工作、重要路径。${spec.minNoteChars}~${spec.maxNoteChars} 字，宜细不宜粗；不可复原的细节先落盘到文件。` },
        deep: { type: 'boolean', description: '用完整交接与找回路径替换历史而不调用摘要模型。替换必须比所选历史更小；保留的正文量和负载会重新计量。身份、目标与判断归属保持原有设定，缺失细节从原始日志或检查点核对。' },
        recovery: { type: 'string', minLength: spec.minNoteChars, maxLength: spec.maxNoteChars, description: `deep 为真时必填。下一个你怎样把细节找回来：用哪些关键词搜会话日志、读哪些文件、任务材料放在哪里。要写搜索真能命中的词、真存在的路径。${spec.minNoteChars}~${spec.maxNoteChars} 字。` },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('context_rest 需要一个所属会话')
      exec.signal.throwIfAborted()
      const keys = args && typeof args === 'object' && !Array.isArray(args) ? Object.keys(args) : []
      if (keys.some(key => key !== 'note' && key !== 'deep' && key !== 'recovery')) throw new Error('context_rest 只接受 note、deep 和 recovery 三个参数')
      // 长度**按 trim 后算**：一串空白不算"写细了"。
      // 下限是要求（宜细不宜粗），不是防呆 —— 几百字的笔记下一个自己还得回去翻日志。
      const noteLength = typeof args?.note === 'string' ? args.note.trim().length : 0
      if (noteLength < spec.minNoteChars || noteLength > spec.maxNoteChars) {
        throw new Error(`context_rest 的 note 需要 ${spec.minNoteChars}-${spec.maxNoteChars} 个字符（宜细不宜粗），实际 ${noteLength} 个`)
      }
      const deep = args.deep === true
      const recovery = args.recovery
      const recoveryLength = typeof recovery === 'string' ? recovery.trim().length : 0
      if (recovery !== undefined
        && (typeof recovery !== 'string' || recoveryLength < spec.minNoteChars || recoveryLength > spec.maxNoteChars)) {
        throw new Error(`context_rest 的 recovery 需要 ${spec.minNoteChars}-${spec.maxNoteChars} 个字符的字符串（宜细不宜粗），实际 ${recoveryLength} 个`)
      }
      if (deep && (typeof recovery !== 'string' || recovery.trim().length === 0)) throw new Error('deep 为真时 context_rest 需要 recovery：历史被清空之后，那段文字是下一个请求把细节找回来的唯一途径')
      const sections = [`历史压缩的交接笔记（你自己写的）：\n${args.note}`]
      if (typeof recovery === 'string' && recovery.trim().length > 0) {
        sections.push(`被清空历史的找回路径（你自己写的）：\n${recovery}`)
      }
      // Inbox insertion is durable. All calls in this batch settle before pre-step claims it.
      exec.agent.inject(notice(requestPlugin, sections.join('\n\n'),
        deep ? 'Deep rest requested' : 'History compaction requested', undefined,
        deep ? { contextRest: { deep: true } } : undefined))
      return deep
        ? '深度休息已经排定在下一个请求边界。它还没完成；下一次上下文状态会报告结果。'
        : '历史压缩已经排定在下一个请求边界。它还没完成；下一次上下文状态会报告结果，之后继续任务。'
    },
    presentCall: () => ({ card: 'generic', title: 'Request history compaction', kind: 'other' }),
  }

  ctx.effect(() => ctx.tools.register(contextStatusTool))
  ctx.effect(() => ctx.tools.register(contextRestTool))

  const requestOwner = {
    owns: agent => ctx.tools.get('context_rest', agent) === contextRestTool,
    promptRules: spec.modelScopedPrompts,
    prompts: spec.modelScopedPrompts.length === 0 ? undefined : (request, previousRoute) => selectScopedPrompts(spec.modelScopedPrompts, request, previousRoute),
    check(call, ready) {
      const request = ready.request
      const { provider, model, reasoningEffort, temperature, maxTokens } = request
      const header = { config: { provider, model, reasoningEffort, temperature, maxTokens }, tools: request.tools,
        adapterDefaults: call.session.requestHeader()?.adapterDefaults }
      // Bind the final route's attachment prices, including an explicitly absent
      // projection. Middleware route changes cannot reuse the previous route.
      const pricing = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: call.session, header,
        imageRequestPricing: ready.imageRequestPricing, requests: ctx.contextCareRequests })
      const inputTokens = pricing.priceRequest(request)
      call.dispatchPricing = pricing
      const policy = budgetPolicy(spec, request, request.purpose ?? 'conversation')
      return contextBudget({ inputTokens, physicalCapacity: ready.model.context?.contextWindow, policyCapacity: policy.contextBudgetTokens,
        billingInputCeilingTokens: policy.billingInputCeilingTokens, maxTokens: request.maxTokens, defaultMaxTokens: ready.model.defaultMaxTokens,
        safetyTokens: request.purpose === 'compaction' ? (spec.summarySafetyTokens ?? spec.safetyTokens) : spec.safetyTokens,
        burstTokens: request.purpose === 'compaction' ? 0 : spec.burstTokens, releaseMarginTokens: 0,
        softRatio: spec.budgetRatio, retainRatio: request.purpose === 'compaction' ? 0 : spec.retainRatio,
        retainTokens: request.purpose === 'compaction' ? 0 : spec.retainTokens })
    },
  }
  ctx.effect(() => ctx.contextCareRequests.register(requestOwner))

  const overflowRetries = new WeakMap()
  ctx.on('agent/idle', ({ agent }) => overflowRetries.delete(agent))
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type !== 'end' || frame.outcome.kind !== 'committed') return
    const event = agent.session.eventAt(frame.outcome.seq)
    if (event?.type === 'assistant/message' && !event.data.interrupted) overflowRetries.delete(agent)
  })
  ctx.on('agent/request-error', async ({ agent, callId, failure, signal }, next) => {
    const delegated = await next()
    const requests = ctx.contextCareRequests
    const failed = callId === undefined ? undefined : requests.snapshot(callId)
    if (failed?.owner !== requestOwner) return delegated
    try {
      if (delegated?.kind === 'retry' || signal.aborted || !['REQUEST_BUDGET_EXCEEDED', 'CONTEXT_WINDOW_EXCEEDED'].includes(failure.code)) return delegated
      const retries = overflowRetries.get(agent) ?? 0
      if (retries >= spec.maxOverflowRetries || failed.dispatchPricing === undefined) return delegated
      overflowRetries.set(agent, retries + 1)
      const session = agent.session
      return await operations.run(session, signal, async signal => {
      try {
        const pruner = prune(agent, failed.dispatchPricing, 'overflow')
        if (pruner !== undefined) await pruner.pruneSession(session)
        signal.throwIfAborted()
        const compaction = resolveCompaction(agent)
        if (compaction !== undefined) {
          const measured = failed.dispatchPricing.measure()
          const range = selectRestRange(session, measured, 0, 0, name)
          if (range !== null) await compactSummary(compaction, { ...range, minFreshTokens: 0 }, agent, signal, failed.dispatchPricing,
            { ...failed.ready.request, messages: session.deriveMessages() })
        }
      } catch (error) {
        if (signal.aborted) throw error
        // A committed prune can still qualify even when summary generation failed.
        ctx.logger.warn(`context-care: overflow maintenance failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      signal.throwIfAborted()
      const proof = recoveryProof(session, failed, failed.dispatchPricing.priceMessages)
      if (!proof.progressed) return delegated
      // Keep the exact dispatched one-shot system/tools and replace the
      // logged history, including its system head, just as the Agent does.
      const after = failed.dispatchPricing.priceRequest({ ...failed.ready.request, messages: session.deriveMessages() })
      if (failure.code === 'REQUEST_BUDGET_EXCEEDED' && after > failed.dispatchBudget.hardInput) return delegated
      return { kind: 'retry' }
      })
    } finally {
      requests.release(callId)
    }
  }, { prepend: true })

  async function collectInputs(agent, signal, accepted, current) {
    const messages = [...accepted]
    try {
      messages.push(...noticeRules.collect({ agent, messages: accepted, facts: careFacts(current, agent.session) }))
    } catch (error) {
      ctx.logger.warn(`context-care: 提示规则没有跑起来: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      const user = lastUserMessage(accepted)
      const assistant = lastAssistantMessage(accepted)
      const notices = await noticeChannel.collect({ agentId: agent.id,
        userText: user === undefined ? '' : textOf(user), assistantText: assistant === undefined ? lastAssistantText(agent.session) : textOf(assistant), signal })
      for (const incoming of notices) messages.push(notice(`${name}:notice:${incoming.source}`, incoming.text, incoming.summary ?? `Notice from ${incoming.source}`))
    } catch (error) {
      if (signal.aborted) throw error
      ctx.logger.warn(`context-care: 通知通道没有跑起来: ${error instanceof Error ? error.message : String(error)}`)
    }
    const loop = detectLoop(agent.session)
    if (loopNeedsReminder(loop, cleanupActive) && !alreadyWarned(agent.session, loopPlugin)) messages.push(notice(loopPlugin, loopNoticeText(loop), 'Output loop detected'))
    return messages
  }

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const generation = agent.session.surface.replaceGeneration
    // Let normal admission and existing automatic safety compaction settle first.
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    // 用户说过话，就允许流式监视重新提醒：清掉这个会话的提醒记账。
    // 判据放在这里而不是流式监听里 —— 只有请求边界才看得到"这一批消息里有没有真人说的话"。
    if (decision.messages.some(message => message.source?.kind === 'user')) {
      const prefix = `${String(agent.id)}:`
      for (const key of [...noticeSent]) {
        if (key.startsWith(prefix)) noticeSent.delete(key)
      }
    }
    // One implementation owns one agent. When this agent's own scope registered
    // the tool (a preset mounted `/agent`), that scoped registration shadows
    // this global one, and the scoped instance must be the only one notifying
    // and compacting — the root entry stands down instead of doing it twice.
    if (typeof ctx.tools.get === 'function') {
      const visible = ctx.tools.get('context_rest', agent)
      if (visible !== undefined && visible !== contextRestTool) return decision
    }
    return operations.run(agent.session, signal, async signal => {
    const restRequest = decision.messages.find(message => producedBy(message.source, requestPlugin))
    const requested = restRequest !== undefined
    let outcome
    let deepCompleted = false
    let current
    let messages = [...decision.messages]
    try {
      // Completion settlement is emitted asynchronously. Await its journal ACK
      // before freezing maintenance prices; ready-time checks would be too late
      // to plan this boundary with the previous completed request's scale.
      await ctx.contextCareRequests.flush?.(agent.session.id)
      const operation = captureInputPricing({ meter: ctx.tokenMeter, llm: ctx.llm, session: agent.session, requests: ctx.contextCareRequests })
      current = await sample(agent, signal, messages, false, operation)
      messages = await collectInputs(agent, signal, decision.messages, current)
      current = await sample(agent, signal, messages, true, operation)
      if (!requested && current.capacity !== undefined && current.loadTokens !== undefined) {
        const maintenanceResult = await pruneThenMeasure({
          session: agent.session,
          measure: async () => {
            const measured = await sample(agent, signal, messages, true, operation)
            return { ...measured, totalTokens: measured.loadTokens ?? measured.measurement.totalTokens }
          },
          pruner: prune(agent, operation, 'automatic'),
          controller: maintenanceFor(agent.session),
        })
        current = maintenanceResult.after
        let pressure = maintenanceResult.pressure
        const compaction = resolveCompaction(agent)
        const passLimit = maintenancePassLimit(compaction, agent, raw?.maxPasses, spec.maxPasses)
        let passes = 0
        while (pressure.shouldMaintain && compaction !== undefined && passes < passLimit) {
          const proposal = propose(agent, current, true)
          if (proposal === null) break
          const result = await executeProposal(compaction, proposal, agent, signal, operation, spec)
          if (result === null) break
          passes += 1
          current = await sample(agent, signal, messages, true, operation)
          pressure = maintenanceFor(agent.session).observeBudget(current.budget)
        }
        if (passes > 0) {
          outcome = pressure.shouldMaintain
            ? `自动维护已执行 ${passes} 次，容量仍在硬预算以上`
            : `自动维护已执行 ${passes} 次，已回到安全预算`
        }
      }
      if (restRequest !== undefined) {
        const deep = restRequest.source.contextRest?.deep === true
        // A delegated summary can satisfy normal rest. Explicit deep rest still
        // owns its handoff and recovery path, even after another replacement.
        if (!deep && agent.session.surface.replaceGeneration !== generation) {
          outcome = '历史已经被本边界的自动维护减少过，不再额外压缩'
        } else if (deep) {
          // 清空不经过 compaction provider：替换物是模型自己写的那条消息，
          // 不需要另起一次 LLM 调用，也就没有"摘要不可能比区间小"那道墙。
          const range = selectClearRange(agent.session)
          if (range === null) {
            outcome = '没有执行——系统提示词之外没有可清空的内容'
          } else {
            const text = restRequest.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
            await maintain(agent.session, operation, 'deep-rest', 'requested', () => clearRange(agent.session, ctx.tokenMeter, range, text, operation))
            deepCompleted = true
            outcome = '历史已用交接和找回路径替换'
            current = await sample(agent, signal, messages.filter(message => message !== restRequest), true, operation)
          }
        } else {
          const compaction = resolveCompaction(agent)
          if (!compaction) {
            outcome = '没有执行——这个会话没有可用的压缩提供方，历史保留'
          } else {
            const proposal = propose(agent, current, false)
            if (proposal === null) {
              outcome = '没有执行——留存近况之外没有足够大的新鲜前缀或可合并检查点'
            } else {
              const result = await executeProposal(compaction, proposal, agent, signal, operation, spec)
              outcome = result === null ? '没有执行——同一选区已验证无法缩小，历史保留' : '较早的历史已摘要，近况与交接笔记保留'
              current = await sample(agent, signal, messages, true, operation)
            }
          }
        }
      }
    } catch (error) {
      if (signal.aborted) throw error
      if (!requested) throw error
      ctx.logger.warn(`context-care: ${error instanceof Error ? error.message : String(error)}`)
      outcome = requested ? '请求没有正常结束；不要假定压缩已经完成；再发下一个请求之前先检查检查点' : undefined
      current = { state: { fatigue: 'unknown', fatigueValue: null, wakefulness: 'unknown', wakefulnessValue: null } }
    }
    if (deepCompleted) messages = messages.filter(message => message !== restRequest)

    const text = renderState(current.state, outcome)
    const previous = previousState(agent.session)
    if (!requested && !shouldNotify(previous, text, current.state)) {
      // 即便状态没变，只要循环提醒挂上了就得把消息带回去。
      return messages.length === decision.messages.length ? decision : { ...decision, messages }
    }
    messages.push(notice(statePlugin, text, 'Context state', current.state))
    return { ...decision, messages }
    })
  }, { prepend: true })

  // 交给 host 入口去注册路由 —— 客户端卡片靠它拿到「哪些内容被改写过」。
  // 记录本身与路由分开:记录在改写路径上,路由是纯读取。
  return { rewriteJournal }
}
