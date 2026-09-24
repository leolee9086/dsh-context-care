// src/rewrite-journal.js — 改写记录:会话日志**之外**的旁路流水账。
//
// 为什么不在会话日志里(2026-09-23/24 查实的结论):
//   · 自定义事件类型会被会话日志的读侧校验拒载 —— 重启后整段日志打不开;
//   · llm/retry 也不行:token-meter 要求当前 open attempt 已有 usage 样本,
//     而我们的改写发生在"这个 step 第一次请求发出之前",那时没有任何 attempt,
//     写下去会让整个 turn 的 token 统计判 invalid。
// 所以改写事实走旁路:索引插件的属性表在就落它那里(持久、可与块索引 JOIN),
// 不在就只在进程内维护。这是"索引插件存在就存它那里,不存在就在进程内"那条范式。
//
// 客户端怎么认出"哪条消息被改过":**用内容哈希,不用 seq**。
// 改写器拿到的是组装好的请求体,里面没有事件 seq —— 它只知道"我清理了这段文本"。
// 而客户端手里有消息原文。两边算同一个哈希就能对上,跨会话也不会误配。
// 哈希用 FNV-1a 32 位:纯 JS,Host 和浏览器两边各一份逐字相同的实现,
// 不需要 node:crypto,也不需要异步的 crypto.subtle。

/** 属性表里的 namespace。 */
export const NAMESPACE = 'context-care'

/** 属性名。同 namespace 下可以有别的属性名,所以它是记录的种类而不是唯一键。 */
export const REWRITE_NAME = 'request-rewrite'

/**
 * FNV-1a 32 位哈希,返回 8 位小写十六进制。
 *
 * 选它是因为**两边都要能算**:Host 侧(这里)和浏览器侧(客户端卡片)必须得到同一个值,
 * 而浏览器没有 node:crypto、crypto.subtle 又是异步的。这个算法几行就能逐字复制。
 *
 * @param {string} text 要哈希的文本。
 * @returns {string} 8 位十六进制。
 */
export function contentHash(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    // FNV 素数的 32 位乘法,用移位拼出来避免超出安全整数范围。
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 把一条消息的 content 拆成「块索引 → 文本」。
 *
 * 只认有 text 的 reasoning / text 块 —— 跟 loop-clean 认的块类型一致,
 * 两边必须用同一套判据,否则哈希对不上。
 *
 * @param {object} message 一条消息。
 * @returns {Array<{index: number, text: string}>} 有文本的块。
 */
export function textBlocksOf(message) {
  const blocks = []
  // 网络请求不沿用 Harness 内部的 content 块格式。
  // Chat Completions 的正文通常是字符串，推理文本在独立字段里。
  if (typeof message?.reasoning_content === 'string') {
    blocks.push({ index: 'reasoning_content', text: message.reasoning_content })
  }
  if (typeof message?.content === 'string') {
    blocks.push({ index: 'content', text: message.content })
  } else if (Array.isArray(message?.content)) {
    for (let index = 0; index < message.content.length; index += 1) {
      const block = message.content[index]
      const text = block?.type === 'thinking' ? block.thinking : block?.text
      if (typeof text !== 'string') continue
      if (!['reasoning', 'text', 'thinking', 'input_text', 'output_text'].includes(block.type)) continue
      blocks.push({ index, text })
    }
  }
  // Responses 的推理摘要不在 message.content 中。
  if (message?.type === 'reasoning' && Array.isArray(message.summary)) {
    for (let index = 0; index < message.summary.length; index += 1) {
      const block = message.summary[index]
      if (block?.type === 'summary_text' && typeof block.text === 'string') {
        blocks.push({ index: 'summary:' + index, text: block.text })
      }
    }
  }
  return blocks
}

/**
 * 找出清理前后真正变了的块,给每个算哈希。
 *
 * 改写器手里有请求体(清理前)和清理结果(清理后),但没有事件 seq ——
 * 所以记录必须自己带上"哪段文本被改过"的证据,那就是这里的哈希。
 *
 * @param {object[]} before 清理前的 messages。
 * @param {object[]} after 清理后的 messages。
 * @returns {Array<{hash: string, charsBefore: number, charsAfter: number}>} 变化的块。
 */
export function changedBlocks(before, after) {
  const changed = []
  // 文本替换可能命中更早的助手消息，不能只看最后一条。
  // 插入/删除消息会使位置不再可靠，此处不猜测它们的配对。
  if (before.length !== after.length) return changed
  for (let index = 0; index < before.length; index += 1) {
    const original = before[index]
    const rewritten = after[index]
    if (original?.role !== 'assistant' && original?.type !== 'reasoning') continue
    if (rewritten == null || original.role !== rewritten.role || original.type !== rewritten.type) continue
    const afterBlocks = textBlocksOf(rewritten)
    for (const block of textBlocksOf(original)) {
      const counterpart = afterBlocks.find(candidate => candidate.index === block.index)
      if (counterpart === undefined || counterpart.text === block.text) continue
      changed.push({
        hash: contentHash(block.text),
        charsBefore: block.text.length,
        charsAfter: counterpart.text.length,
      })
    }
  }
  return changed
}

/**
 * 造一个改写流水账。
 *
 * 两个落点:索引插件的属性表(在时)与进程内(不在时)。读的时候两边都看 ——
 * 属性表可能因为库不可用而写不进去,那时记录只在内存里,读也得读得到。
 *
 * @param {object} deps
 * @param {() => object|undefined} deps.store 取索引插件服务;每次现取(它可能晚于本插件注册)。
 * @param {(message: string) => void} [deps.warn] 诊断输出。
 * @returns {{record: Function, list: Function}} 记录与查询。
 */
export function createRewriteJournal({ store, warn = () => {} }) {
  /** 进程内的那份。sessionId → 记录数组。 */
  const memory = new Map()

  return {
    // 供 HTTP 诊断确认当前进程实际加载了 wire 格式解析，不以磁盘修改时间推断。
    format: 'wire-v1',
    /**
     * 记一次改写。
     *
     * 索引服务在就写属性表(持久);写不进去或服务不在,退到进程内。
     * **任何失败都不抛** —— 记录是旁路,不该毁掉这次请求。
     *
     * @param {object} entry 记录内容。
     * @returns {Promise<{persisted: boolean}>} 是否落了属性表。
     */
    async record(entry) {
      const row = {
        sessionId: entry.sessionId,
        seq: undefined,
        namespace: NAMESPACE,
        name: REWRITE_NAME,
        value: {
          sessionId: entry.sessionId,
          hash: entry.hash,
          pattern: entry.pattern,
          removedLines: entry.removedLines,
          charsBefore: entry.charsBefore,
          charsAfter: entry.charsAfter,
          at: entry.at ?? Date.now(),
        },
        origin: 'plugin',
        visibility: 'user',
      }
      const bucket = memory.get(row.sessionId) ?? []
      bucket.push(row)
      memory.set(row.sessionId, bucket)

      const service = store()
      if (service === undefined || typeof service.putAttribute !== 'function') return { persisted: false }
      try {
        const id = await service.putAttribute(row)
        return { persisted: typeof id === 'string' }
      } catch (error) {
        warn('context-care: 改写记录没写进属性表,只留在进程内: ' + (error instanceof Error ? error.message : String(error)))
        return { persisted: false }
      }
    },

    /**
     * 列出某个会话的改写记录。
     *
     * 属性表与进程内**合并**返回(按哈希去重):属性表里可能有别的进程写下的记录,
     * 内存里有这个进程刚写、还没落表的记录。
     *
     * @param {object} filter `{ sessionId }`。
     * @returns {Promise<Array<object>>} 记录数组,新在前。
     */
    async list(filter = {}) {
      const sessionId = filter.sessionId
      const rows = []
      const service = store()
      // 不带 sessionId = 所有会话。客户端节点定义拿不到 sessionId
      // (ConversationNodeContext 里只有 key/kind/id/matches/start/state),
      // 所以它拉全量、按内容哈希匹配 —— 哈希相同就意味着文本相同,不会配错。
      if (service !== undefined && typeof service.listAttributes === 'function') {
        try {
          const query = { namespace: NAMESPACE, name: REWRITE_NAME }
          if (sessionId !== undefined) query.sessionId = sessionId
          const stored = await service.listAttributes(query)
          for (const item of stored) rows.push({ hash: item.value?.hash, value: { ...item.value, sessionId: item.sessionId } })
        } catch (error) {
          warn('context-care: 读属性表失败,只返回进程内的记录: ' + (error instanceof Error ? error.message : String(error)))
        }
      }
      const buckets = sessionId === undefined ? [...memory.values()] : [memory.get(sessionId) ?? []]
      for (const bucket of buckets) {
        for (const item of bucket) rows.push({ hash: item.value.hash, value: item.value })
      }
      // 同一个哈希可能两边都有(属性表里是别的进程写的、内存里是这个进程刚写的),
      // **按时间取最新的那份** —— 先到先得会把刚写的那条丢掉。
      const latest = new Map()
      for (const row of rows) {
        if (typeof row.hash !== 'string' || row.hash === '') continue
        const key = row.value?.sessionId + ':' + row.hash
        const previous = latest.get(key)
        if (previous === undefined || (row.value?.at ?? 0) > (previous?.at ?? 0)) latest.set(key, row.value)
      }
      const unique = [...latest.values()]
      unique.sort((left, right) => (right?.at ?? 0) - (left?.at ?? 0))
      return unique
    },
  }
}
