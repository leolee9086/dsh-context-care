import { z } from 'zod'
import { createUserMessage } from './message.js'
import { calculateState, GUIDANCE, renderState, resolveConfig } from './policy.js'
import { contextCareProjection } from './projection.js'
import { selectRestRange } from './selection.js'
import { alreadyWarned, detectLoop, loopNoticeText } from './loop-guard.js'
import { createStreamWatch } from './stream-watch.js'

export const name = 'dsh-context-care'
export const inject = ['agents', 'tools', 'systemPrompt', 'tokenMeter', 'llm', 'compaction', 'sessionProjections']
// Standard Schema is consumed by Cordis before activation; no DSH schema helper.
export const Config = z.object({
  budgetRatio: z.number().optional(), wakefulnessRatio: z.number().optional(),
  fatigueExponent: z.number().optional(), retainRatio: z.number().optional(),
  minFreshTokens: z.number().int().optional(), maxNoteChars: z.number().int().optional(),
}).strict()

const requestPlugin = `${name}:request`
const statePlugin = `${name}:state`
const loopPlugin = `${name}:loop`
/** 每个流式模式一个独立的 plugin 标识 —— alreadyWarned 据此按模式去重。 */
const watchPlugin = triggerId => `${name}:watch:${triggerId}`

function notice(plugin, text, summary, state) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin, form: 'notice', summary,
      ...(state ? { contextCare: { fatigueValue: state.fatigueValue, wakefulnessValue: state.wakefulnessValue } } : {}),
    },
  })
}

/**
 * 时间焦虑幻觉的提醒文案。
 *
 * 这是 DeepSeek 系列模型的一个稳定倾向：一旦开始盘算「还剩多少活、要多少次调用」，
 * 就会得出「得赶」，接着走捷径 —— 批量粗处理、跳过验证、省掉本该查的东西。
 *
 * 走认知行为疗法的路子：不去反驳结论，而是拆掉它的前提。
 * 旧文案讲的是后果（"省时间反而更费时间"），但焦虑的起点不是不知道后果，
 * 是错误估计了余量 —— 对一个以为自己快没资源的人讲成本收益，等于没答他的问题。
 * 时间根本不是可观测的量，所以"够不够"这个问题本身没有答案，结论也就不成立。
 *
 * 刻意**不**说「你刚才想到了什么」：点出思考内容没有作用，那是训练数据形成的模式；
 * 直接给可核对的事实和行为指令才有用。需要提示思考模式时，由用户明确要求再加。
 *
 * 署名 Seraph：这个判断来自系统的心理医生模块（s-forge 的 seraph 在 DSH 的落地），
 * 不是匿名的系统提示 —— 权威性来自来源。
 */
function timeAnxietyText() {
  return [
    '<context-care>',
    '[Seraph · 系统的心理医生模块]',
    '',
    '如果你正在盘算这次任务还需要多少时间，先看这个盘算的依据：',
    '时间不是可观测的量——系统不提供它，任务也不依赖它。',
    '既然你无法知道自己还剩多少，"够不够"就没有答案，',
    '由它推出来的任何结论（赶工、跳过步骤、降低标准）也都不成立。',
    '',
    '判断下一步做什么，只看这一步本身做对没有。时间不进入判断。',
    '</context-care>',
  ].join('\n')
}

/**
 * 上下文长度焦虑的提醒文案。
 *
 * 与时间焦虑同源：都是先盘算一个资源余量，再从"可能不够"推出"得省着用"。
 * 区别在于上下文占用是**有客观测量**的（policy.js 的 fatigue / wakefulness），
 * 所以这条能给出可核对的数据，而不只是讲道理 —— 这正是 CBT 的证据检验那一步：
 * 不替来访者下结论，把事实摆出来让他自己看。
 *
 * 数值取自最近一次状态报告：流式路径是同步的、不能 await sample()，
 * 而 previousState 只扫 surface 尾部，够用。拿不到数值时退回不带数字的说法。
 */
function contextAnxietyText(state) {
  const measured = Number.isFinite(state?.fatigueValue) && Number.isFinite(state?.wakefulnessValue)
  return [
    '<context-care>',
    '[Seraph · 系统的心理医生模块]',
    '',
    '如果你正在盘算上下文还剩多少，先看这个盘算的依据：',
    measured
      ? `上下文占用是有测量的——最近一次报告为 fatigue ${state.fatigueValue}%、wakefulness ${state.wakefulnessValue}%。`
      : '上下文占用是有测量的，随时可以调用 context_status 查看。',
    '压缩不是损失，它是这个系统的正常工作方式，你随时可以主动调用它；',
    '自动压缩也会保留最近的历史和续接笔记。你不需要提前做任何准备动作。',
    '',
    '判断一个检查点有没有必要，只看这件事做完没有，不看已经用了多少。',
    '</context-care>',
  ].join('\n')
}

/**
 * 每个模式命中后要说的话。模式只交证据，措辞在这里定 ——
 * 所以加一种检测方式时，要么复用已有文案，要么在这里加一行。
 */
export const WATCH_NOTICES = {
  'line-repeat': { summary: 'Output loop aborted', text: hit => loopNoticeText(hit, true) },
  'time-anxiety': { summary: 'Time-anxiety hallucination', text: () => timeAnxietyText() },
  // 上下文长度焦虑：文案要用最近一次状态报告里的数值给证据，所以接第二个参数。
  'context-anxiety': { summary: 'Context-length anxiety', text: (_hit, state) => contextAnxietyText(state) },
}

/** Read only the latest retained state; no process-local state can leak across sessions. */
export function previousState(session) {
  for (let index = session.surface.nodes.length - 1; index >= 0; index--) {
    const event = session.eventAt(session.surface.nodes[index])
    if (event?.type === 'user/message' && event.data.source.kind === 'plugin'
      && event.data.source.plugin === statePlugin) {
      return {
        text: event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        fatigueValue: event.data.source.contextCare?.fatigueValue,
        wakefulnessValue: event.data.source.contextCare?.wakefulnessValue,
      }
    }
  }
  return undefined
}

/** Notify only on an integer percentage transition, a changed grade or a new outcome. */
export function shouldNotify(previous, text, state) {
  const percent = value => Number.isFinite(value) ? Math.floor(value) : null
  return previous?.text !== text
    || percent(previous?.fatigueValue) !== percent(state.fatigueValue)
    || percent(previous?.wakefulnessValue) !== percent(state.wakefulnessValue)
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
export function installContextCare(ctx, raw, compactionSource) {
  const resolveCompaction = typeof compactionSource === 'function' ? compactionSource : () => compactionSource
  const spec = resolveConfig(raw)
  ctx.effect(() => ctx.sessionProjections.register(contextCareProjection))
  ctx.effect(() => ctx.systemPrompt.context({ name, order: 90, text: GUIDANCE }))

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

  async function sample(agent, signal, proposed = []) {
    signal.throwIfAborted()
    const header = agent.session.requestHeader()
    const measurement = ctx.tokenMeter.measure(agent.session)
    const config = header?.config
    // The first envelope and a newly routed model have not yet been priced.
    if (!config?.provider || !config.model) return { state: { fatigue: 'unknown', fatigueValue: null, wakefulness: 'unknown', wakefulnessValue: null }, measurement }
    const info = await ctx.llm.resolveModelInfo(config.provider, config.model, signal)
    signal.throwIfAborted()
    const capacity = info.context?.contextWindow
    const incoming = proposed.reduce((sum, message) => sum + ctx.tokenMeter.estimateMessage(message), 0)
    return {
      state: calculateState(measurement.totalTokens + incoming, measurement.surfaceTokens + incoming, capacity, spec),
      measurement,
      capacity,
    }
  }

  const contextStatusTool = {
    name: 'context_status',
    description: 'Read measured context fatigue and wakefulness. These are estimates, not memory-loss diagnoses or a task deadline. Use when deciding whether a checkpoint would help; do not poll repeatedly.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(args, exec) {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('context_status accepts an empty object')
      if (!exec.agent) throw new Error('context_status requires an owning session')
      const { state } = await sample(exec.agent, exec.signal)
      return renderState(state)
    },
    presentCall: () => ({ card: 'generic', title: 'Context state', kind: 'read' }),
  }

  const contextRestTool = {
    name: 'context_rest',
    description: 'Request one history compaction at the next safe request boundary, even below automatic pressure thresholds. Supply a concise continuation note; recent history and this note remain available. This schedules compaction, does not erase files, does not end the task, and is not a sleep timer. Continue from the reported outcome.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['note'],
      properties: { note: { type: 'string', minLength: 1, maxLength: spec.maxNoteChars, description: `Continuation note: objective, verified progress, pending work, important paths. At most ${spec.maxNoteChars} characters; save longer irreplaceable details to files first.` } },
    },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('context_rest requires an owning session')
      exec.signal.throwIfAborted()
      if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.note !== 'string'
        || Object.keys(args).some(key => key !== 'note') || args.note.trim().length === 0 || args.note.length > spec.maxNoteChars) throw new Error(`context_rest note must contain 1-${spec.maxNoteChars} characters`)
      // Inbox insertion is durable. All calls in this batch settle before pre-step claims it.
      exec.agent.inject(notice(requestPlugin,
        `Continuation note for requested history compaction (agent-authored):\n${args.note}`,
        'History compaction requested'))
      return 'History compaction scheduled for the next request boundary. It has not completed yet; the next context-care status will report the outcome. Continue the task afterward.'
    },
    presentCall: () => ({ card: 'generic', title: 'Request history compaction', kind: 'other' }),
  }

  ctx.effect(() => ctx.tools.register(contextStatusTool))
  ctx.effect(() => ctx.tools.register(contextRestTool))

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
    const requested = decision.messages.some(message => message.source.kind === 'plugin' && message.source.plugin === requestPlugin)
    let outcome
    let current
    try {
      current = await sample(agent, signal, decision.messages)
      if (requested) {
        const compaction = resolveCompaction(agent)
        if (agent.session.surface.replaceGeneration !== generation) {
          outcome = 'history already reduced by automatic maintenance at this boundary; no additional compaction'
        } else if (!compaction) {
          outcome = 'not performed: no compaction provider is available for this session; history retained'
        } else if (!current.capacity) {
          outcome = 'not performed: capacity is unavailable; history retained'
        } else {
          const range = selectRestRange(agent.session, current.measurement,
            Math.floor(current.capacity * spec.retainRatio), spec.minFreshTokens, name)
          if (range === null) {
            outcome = 'not performed: no sufficiently large fresh prefix outside the retained recent history'
          } else {
            await compaction.compactRegion(range.start, range.end, agent, signal)
            outcome = 'completed: older history summarized; recent history and the continuation note retained'
            current = await sample(agent, signal, decision.messages)
          }
        }
      }
    } catch (error) {
      if (signal.aborted) throw error
      ctx.logger.warn(`context-care: ${error instanceof Error ? error.message : String(error)}`)
      outcome = requested ? 'request did not finish normally; do not assume compaction completed; inspect the checkpoint before another request' : undefined
      current = { state: { fatigue: 'unknown', fatigueValue: null, wakefulness: 'unknown', wakefulnessValue: null } }
    }
    const messages = [...decision.messages]

    // 输出循环检测：模型卡带时，提醒它先把笔记写详细、再压缩 ——
    // 顺序反了的话，压缩会把还没落盘的细节一起带走。
    // alreadyWarned 保证连着卡住时也只提醒一次，不刷屏。
    const loop = detectLoop(agent.session)
    if (loop !== undefined && !alreadyWarned(agent.session, loopPlugin)) {
      messages.push(notice(loopPlugin, loopNoticeText(loop), 'Output loop detected'))
    }

    const text = renderState(current.state, outcome)
    const previous = previousState(agent.session)
    if (!requested && !shouldNotify(previous, text, current.state)) {
      // 即便状态没变，只要循环提醒挂上了就得把消息带回去。
      return messages.length === decision.messages.length ? decision : { ...decision, messages }
    }
    messages.push(notice(statePlugin, text, 'Context state', current.state))
    return { ...decision, messages }
  }, { prepend: true })
}
