// src/notice-channel.js — 通用通知通道:别的插件有话要告诉模型时,往这里放。
//
// 通道只知道两件事:**要通知什么**(text)和**什么时候能通知**(id / 冷却 / 去重)。
// 它不认识「召回」、不认识「分数」、不认识任何具体来源 ——
// 分数是源自己的判断依据(词法召回看 bm25,以后的向量召回看余弦距离),
// 源判断完,够格就放进来,不够格就不放。所以谁都可以注册一个源。
//
// 拉模式,不是推模式:每个请求边界,通道把当前上下文交给每个源,
// 源回答「这一轮有什么要说的」。源不需要知道什么时候该说话,
// 也就不需要自己维护时机状态 —— 少一份状态就少一处不一致。

/** 通道的服务名。别的插件 ctx.get 它,然后 register。 */
export const NOTICE_CHANNEL = 'contextNotices'

/**
 * 建一个通道。
 *
 * @param {object} [options]
 * @param {() => number} [options.now] 取当前时间;测试用。
 * @param {(message: string) => void} [options.warn] 记一条警告。
 * @returns {{register: Function, collect: Function}}
 */
export function createNoticeChannel({ now = () => Date.now(), warn = () => {} } = {}) {
  /** 源:名字 → 函数。 */
  const sources = new Map()
  /** 「会话 + 通知 id」→ 上次注入的时间。 */
  const pushed = new Map()

  /**
   * 注册一个通知源。返回取消注册的函数。
   * @param {string} name 源名,会写进注入消息的 source.plugin。
   * @param {(context: object) => (object[]|undefined|null|Promise<object[]|undefined|null>)} source
   *        拿到当前上下文,返回这一轮该注入的通知。
   */
  function register(name, source) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('context-care: 通知源要有名字')
    }
    if (typeof source !== 'function') {
      throw new Error(`context-care: 通知源 "${name}" 要是一个函数`)
    }
    sources.set(name, source)
    return () => sources.delete(name)
  }

  /** 一条通知的形状是不是说得清楚。说不清楚就抛错,不猜。 */
  function check(notice, name) {
    if (typeof notice !== 'object' || notice === null) {
      throw new Error(`context-care: 通知源 "${name}" 产出的不是对象`)
    }
    if (typeof notice.id !== 'string' || notice.id.length === 0) {
      throw new Error(`context-care: 通知源 "${name}" 产出的通知没有 id`)
    }
    if (typeof notice.text !== 'string' || notice.text.length === 0) {
      throw new Error(`context-care: 通知源 "${name}" 产出的通知 "${notice.id}" 没有 text`)
    }
  }

  /**
   * 问每个源要这一轮的通知,滤掉不该重复的,返回该注入的。
   *
   * 一个源自己出错,不该挡住别的源,也不该毁掉整个请求 —— 记一条 warn 跳过它。
   * 这不是静默:日志里有。
   *
   * @param {object} context `{ agentId, userText, assistantText, signal }`。
   * @returns {Promise<object[]>} 该注入的通知(已带上 source 字段)。
   */
  async function collect(context) {
    const key = String(context.agentId)
    const out = []
    for (const [name, source] of sources) {
      let produced
      try {
        produced = await source({ ...context, agentId: key })
      } catch (error) {
        warn(`context-care: 通知源 "${name}" 出错: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (produced === undefined || produced === null) continue
      if (!Array.isArray(produced)) {
        warn(`context-care: 通知源 "${name}" 返回的不是数组`)
        continue
      }
      for (const notice of produced) {
        check(notice, name)
        const stamp = key + '\u0000' + notice.id
        const since = pushed.get(stamp)
        if (since !== undefined) {
          // oncePerSurface 默认开:同一条通知在一个会话里只注入一次。
          // 关掉它才看冷却 —— 冷却管时间,去重管内容,是两回事。
          if (notice.oncePerSurface !== false) continue
          const cooldown = Number(notice.cooldownMinutes ?? 0)
          if (cooldown > 0 && now() - since < cooldown * 60000) continue
        }
        pushed.set(stamp, now())
        out.push({ ...notice, source: name })
      }
    }
    return out
  }

  return { register, collect }
}
