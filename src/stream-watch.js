/**
 * 流式监视管线 —— 「检测模式 → 执行操作」的通用引擎。
 *
 * 引擎只做两件事：维护视图，然后把模式交出的证据交给操作执行。
 * 它不认识"循环"，也不认识任何一个具体模式；加模式就是往 DETECTORS 加一个判定器，
 * 加行为就是往调用方的 actions 表加一项。
 *
 * ## 为什么通篇在谈性能
 *
 * 实测：一次回复 1479 帧，delta 粒度 1–4 个字符，其中思考块占 1331 帧。
 * 也就是说"每个 delta 顺手做一次全文操作"这种写法会被放大上千倍 ——
 * 每个 delta 复制一次 8 KB 缓冲，一轮下来就是上千万字符的无谓复制与扫描。
 * 将来模式变多，每个模式再各来一遍就是灾难。
 *
 * 所以这里立了三条规矩：
 *
 * 1. **累积不靠字符串拼接。** 文本按块存进数组（push 是 O(1)），只在需要证据时拼接；
 *    需要丢旧内容时丢整块，不做整串 slice。
 * 2. **模式必须自报节奏。** `incremental` 每帧都看，但只允许 O(新文本)；
 *    `windowed` 昂贵，按累计字节节流，引擎不到量就不叫它。
 * 3. **判定共享同一份视图。** 行窗口与行计数在遇到换行时增量维护，
 *    判定时直接读，不重新切分整段文本。
 *
 * @module dsh-context-care/stream-watch
 */

/** 每个视图保留的文本上限（字符）；只丢最旧的块，尾部始终完整。 */
export const TEXT_LIMIT = 16384
/** 行窗口：判定只看末尾这么多行。 */
export const LINE_WINDOW = 80
/** 太短的行不参与统计（代码里的 `}`、空行天然会重复，会把比例带偏）。 */
export const MIN_LINE_LEN = 3
/** 单行保留上限；超长单行截断，避免它把内存和判定成本拖垮。 */
export const LINE_LIMIT = 4096
/** `windowed` 节奏的默认节流粒度（字符）。 */
export const WINDOWED_EVERY = 300

// ---------------------------------------------------------------- 视图

/** 一份流式视图：分块文本 + 末尾行窗口 + 行计数。测试直接用它。 */
export function createView() {
  return {
    chunks: [],
    length: 0,
    /** 尚未遇到换行的当前行。 */
    line: '',
    /** 末尾行窗口（已 trim、已过滤短行）。 */
    window: [],
    /** 行 → 出现次数，与 window 严格同步。 */
    counts: new Map(),
    /** 自上次 windowed 判定以来累积的字符数。 */
    bytes: 0,
  }
}

/** 把一行收进窗口，并淘汰最旧的一行。 */
function pushLine(view, line) {
  const trimmed = line.trim()
  if (trimmed.length < MIN_LINE_LEN) return
  view.window.push(trimmed)
  view.counts.set(trimmed, (view.counts.get(trimmed) ?? 0) + 1)
  while (view.window.length > LINE_WINDOW) {
    const dropped = view.window.shift()
    const remaining = view.counts.get(dropped) - 1
    if (remaining <= 0) view.counts.delete(dropped)
    else view.counts.set(dropped, remaining)
  }
}

/**
 * 把一段增量文本喂进视图。
 *
 * 成本：O(新文本) + O(本段里的换行数) —— 与已累积的文本量无关。
 * @param view - 目标视图
 * @param text - 本次到达的增量文本
 */
export function appendText(view, text) {
  // 单块就超上限时先截断，否则"只丢最旧的块"这条规则会被一个超长块绕过。
  const piece = text.length > TEXT_LIMIT ? text.slice(-TEXT_LIMIT) : text
  view.chunks.push(piece)
  view.length += piece.length
  view.bytes += piece.length
  while (view.length > TEXT_LIMIT && view.chunks.length > 1) {
    view.length -= view.chunks.shift().length
  }

  let start = 0
  for (;;) {
    const newline = piece.indexOf('\n', start)
    if (newline === -1) break
    pushLine(view, view.line + piece.slice(start, newline))
    view.line = ''
    start = newline + 1
  }
  view.line = (view.line + piece.slice(start)).slice(-LINE_LIMIT)
}

/**
 * 拼出视图当前保留的尾部文本。
 *
 * 只给证据与调试用 —— 判定不依赖它，所以拼接成本不会落到每一帧上。
 * @param view - 目标视图
 * @param limit - 最多返回多少个字符
 * @returns 尾部文本
 */
export function viewTail(view, limit = 600) {
  // 只用分块缓冲：未完成行已经在那里面了，再并上 view.line 会重复末尾。
  const all = view.chunks.join('')
  return all.length <= limit ? all : all.slice(-limit)
}

// ------------------------------------------------------------ 判定器

/**
 * 判定器表。每个判定器声明自己的节奏，并交出证据（hit）或 undefined。
 *
 * - `incremental`：`feed(state, text, spec)`，每帧调用，只允许 O(新文本)。
 * - `windowed`：`check(view, state, spec)`，按字节节流后调用，读共享视图。
 *
 * 判定器自带的小状态由 `create(spec)` 产出，每个 (会话, 模式) 一份。
 */
export const DETECTORS = {
  /**
   * 指定的标记出现在窗口里即命中。
   * 用滑动窗口匹配：只保留"可能与下一帧拼出标记"的尾巴，成本与缓冲大小无关。
   */
  marker: {
    cadence: 'incremental',
    create(spec) {
      return { token: typeof spec.token === 'string' ? spec.token : '', carry: '' }
    },
    feed(state, text) {
      if (state.token.length === 0) return undefined
      const scope = state.carry + text
      const at = scope.indexOf(state.token)
      // 只留 token 长度 - 1 个字符：更长的部分不可能再参与拼出标记。
      // 长度为 1 的标记要特判 —— 此时进位量是 0，而 slice(-0) 等于 slice(0)（整串），
      // 会让尾巴越涨越长，滑动窗口就白做了。
      state.carry = state.token.length === 1 ? '' : scope.slice(-(state.token.length - 1))
      if (at === -1) return undefined
      return { kind: 'marker', token: state.token }
    },
  },

  /**
   * 一组短语里任意一个出现即命中。
   *
   * 这是给"模型说了某类话"用的通用模式：词表由调用方给，判定器不认识任何具体词义。
   * 同样是滑动窗口 —— 只保留最长短语长度 - 1 的进位尾巴，成本与缓冲大小无关。
   */
  phrase: {
    cadence: 'incremental',
    create(spec) {
      const phrases = Array.isArray(spec.phrases)
        ? spec.phrases.filter(phrase => typeof phrase === 'string' && phrase.length > 0)
        : []
      let longest = 0
      for (const phrase of phrases) {
        if (phrase.length > longest) longest = phrase.length
      }
      return { phrases, carry: '', keep: Math.max(0, longest - 1) }
    },
    feed(state, text) {
      if (state.phrases.length === 0) return undefined
      const window = state.carry + text
      let matched
      for (const phrase of state.phrases) {
        if (window.indexOf(phrase) !== -1) {
          matched = phrase
          break
        }
      }
      // 同 marker：进位量为 0 时不能走 slice(-0)。
      state.carry = state.keep === 0 ? '' : window.slice(-state.keep)
      if (matched === undefined) return undefined
      return { kind: 'phrase', phrase: matched }
    },
  },

  /**
   * 末尾窗口里某一行反复出现，或同一行连续重复。
   * 读增量维护好的行窗口与计数，不再切分文本。
   */
  'line-repeat': {
    cadence: 'windowed',
    create() {
      return {}
    },
    check(view, _state, spec) {
      const minLines = spec.minLines ?? 30
      if (view.window.length < minLines) return undefined

      let worstLine = ''
      let worstCount = 0
      for (const [line, count] of view.counts) {
        if (count > worstCount) {
          worstLine = line
          worstCount = count
        }
      }
      const total = view.window.length
      const ratio = worstCount / total

      let run = 1
      let bestRun = 1
      for (let index = 1; index < total; index += 1) {
        if (view.window[index] === view.window[index - 1]) {
          run += 1
          if (run > bestRun) bestRun = run
        } else {
          run = 1
        }
      }

      const byCount = worstCount >= (spec.minCount ?? 30) && ratio >= (spec.minRatio ?? 0.35)
      const byRun = bestRun >= (spec.minRun ?? 12)
      if (!byCount && !byRun) return undefined
      return {
        kind: 'line-repeat',
        line: worstLine.slice(0, 40),
        count: worstCount,
        total,
        ratio: Math.round(ratio * 100) / 100,
        run: bestRun,
      }
    },
  },
}

// -------------------------------------------------------------- 引擎

/**
 * 建一套流式监视管线。
 *
 * @param options.triggers - 模式列表；每项至少要有 `id`、`kind`、`actions`，
 *   可带 `scope`（`text` / `reasoning` / `combined`，默认 `combined`）与判定器自己的
 *   阈值字段；`windowed` 模式可带 `everyBytes`。
 * @param options.actions - 操作表：名字 → 回调；回调收到 `{ agent, trigger, hit }`。
 * @param options.onError - 判定或操作抛错时的回调，默认交给 `console.error`
 * @returns 管线实例
 */
export function createStreamWatch({ triggers, actions, onError }) {
  /** 本次挂载用到的 scope，去重后固定下来，避免每帧重新推导。 */
  const scopes = [...new Set(triggers.map(trigger => trigger.scope ?? 'combined'))]
  const perAgent = new Map()

  const report = (error, context) => {
    if (typeof onError === 'function') onError(error, context)
    else console.error(`[dsh-context-care] stream-watch ${context}:`, error)
  }

  function entryFor(agentId) {
    let entry = perAgent.get(agentId)
    if (entry === undefined) {
      entry = { views: new Map(), states: new Map(), fired: new Set(), hits: [], errors: [] }
      perAgent.set(agentId, entry)
    }
    return entry
  }

  function viewFor(entry, scope) {
    let view = entry.views.get(scope)
    if (view === undefined) {
      view = createView()
      entry.views.set(scope, view)
    }
    return view
  }

  function stateFor(entry, trigger) {
    let state = entry.states.get(trigger.id)
    if (state === undefined) {
      state = DETECTORS[trigger.kind].create(trigger)
      entry.states.set(trigger.id, state)
    }
    return state
  }

  function fire(agent, entry, trigger, hit) {
    entry.fired.add(trigger.id)
    entry.hits.push({ at: Date.now(), triggerId: trigger.id, ...hit })
    if (entry.hits.length > 40) entry.hits.shift()
    for (const name of trigger.actions ?? []) {
      const action = actions[name]
      if (typeof action !== 'function') {
        entry.errors.push(`unknown action ${name}`)
        continue
      }
      try {
        action({ agent, trigger, hit })
      } catch (error) {
        entry.errors.push(`action ${name}: ${error instanceof Error ? error.message : String(error)}`)
        report(error, `action ${name}`)
      }
    }
  }

  /**
   * 喂一帧。`start` 帧重置该会话的判定状态，`chunk` 帧累积并跑模式。
   * 同步执行，绝不 await —— 它挂在同步广播上，把流卡住就等于毁掉这次生成。
   */
  function observe(agent, frame) {
    if (agent === undefined || agent === null || agent.id === undefined) return
    const entry = entryFor(String(agent.id))
    const type = frame === undefined || frame === null ? undefined : frame.type

    if (type === 'start') {
      entry.views.clear()
      entry.states.clear()
      entry.fired.clear()
      return
    }
    if (type !== 'chunk') return

    const chunk = frame.chunk
    if (chunk === undefined || chunk === null) return
    const isText = chunk.type === 'text-delta'
    const isReasoning = chunk.type === 'reasoning-delta'
    if (!isText && !isReasoning) return
    const text = typeof chunk.text === 'string' ? chunk.text : ''
    if (text.length === 0) return

    for (const scope of scopes) {
      if (scope === 'text' && !isText) continue
      if (scope === 'reasoning' && !isReasoning) continue
      appendText(viewFor(entry, scope), text)
    }

    for (const trigger of triggers) {
      if (entry.fired.has(trigger.id)) continue
      const detector = DETECTORS[trigger.kind]
      if (detector === undefined) continue
      const scope = trigger.scope ?? 'combined'
      let hit
      try {
        if (detector.cadence === 'incremental') {
          if (scope === 'text' && !isText) continue
          if (scope === 'reasoning' && !isReasoning) continue
          hit = detector.feed(stateFor(entry, trigger), text, trigger)
        } else {
          const view = viewFor(entry, scope)
          if (view.bytes < (trigger.everyBytes ?? WINDOWED_EVERY)) continue
          view.bytes = 0
          hit = detector.check(view, stateFor(entry, trigger), trigger)
        }
      } catch (error) {
        entry.errors.push(`detect ${trigger.id}: ${error instanceof Error ? error.message : String(error)}`)
        report(error, `detect ${trigger.id}`)
        continue
      }
      if (hit === undefined) continue
      fire(agent, entry, trigger, hit)
    }
  }

  /** 调试快照：每个会话的画面、命中与错误。 */
  function inspect() {
    const out = {}
    for (const [agentId, entry] of perAgent) {
      const views = {}
      for (const [scope, view] of entry.views) {
        views[scope] = { lines: view.window.length, bytes: view.bytes, tail: viewTail(view, 200) }
      }
      out[agentId] = { views, hits: entry.hits, errors: entry.errors, fired: [...entry.fired] }
    }
    return out
  }

  return { observe, inspect }
}
