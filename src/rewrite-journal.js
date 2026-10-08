// src/rewrite-journal.js — 改写记录:会话日志**之外**的旁路流水账。
//
// 为什么不在会话日志里(2026-09-23/24 查实的结论):
//   · 自定义事件类型会被会话日志的读侧校验拒载 —— 重启后整段日志打不开;
//   · llm/retry 也不行:token-meter 要求当前 open attempt 已有 usage 样本,
//     而我们的改写发生在"这个 step 第一次请求发出之前",那时没有任何 attempt,
//     写下去会让整个 turn 的 token 统计判 invalid。
// 改写事实走插件自己的 Host 持久域；可选索引属性表仍写一份用于块索引 JOIN。
// 单独使用此工厂可不传 durable；正式 runtime 必须传入，避免无索引时重启丢记录。
//
// 客户端怎么认出"哪条消息被改过":**用内容哈希,不用 seq**。
// 改写器拿到的是组装好的请求体,里面没有事件 seq —— 它只知道"我清理了这段文本"。
// 客户端用 sessionId + 内容哈希查找；哈希是显示关联线索，不是无碰撞的身份或发送证明。
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

/** 片段上限:卡片是给人扫一眼的,不是全文 diff。 */
const SNIPPET_LIMIT = 80

/**
 * 取改动前后的差异片段。
 *
 * 掐掉公共前缀和后缀,中间那段就是这次改写真正动过的地方 ——
 * 卡片要回答的是「改了什么」,字符数只说明「改了多少」。
 * 纯插入/纯删除时其中一端会是空串,照实返回。
 *
 * @param {string} before 改写前的文本。
 * @param {string} after 改写后的文本。
 * @returns {{removed: string, added: string}} 截断后的差异片段。
 */
function diffSnippet(before, after) {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1
  let tailBefore = before.length
  let tailAfter = after.length
  while (tailBefore > head && tailAfter > head && before[tailBefore - 1] === after[tailAfter - 1]) {
    tailBefore -= 1
    tailAfter -= 1
  }
  return {
    removed: clip(before.slice(head, tailBefore)),
    added: clip(after.slice(head, tailAfter)),
  }
}

/** 片段过长时截断,保留开头 —— 改动的形状通常在开头就看得出来。 */
function clip(text) {
  return text.length <= SNIPPET_LIMIT ? text : text.slice(0, SNIPPET_LIMIT) + '…'
}

/**
 * 找出清理前后真正变了的块,给每个算哈希。
 *
 * 改写器手里有请求体(清理前)和清理结果(清理后),但没有事件 seq ——
 * 所以记录必须自己带上"哪段文本被改过"的证据,那就是这里的哈希。
 *
 * @param {object[]} before 清理前的 messages。
 * @param {object[]} after 清理后的 messages。
 * @returns {Array<{hash: string, charsBefore: number, charsAfter: number, removed: string, added: string}>} 变化的块。
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
      const snippet = diffSnippet(block.text, counterpart.text)
      changed.push({
        hash: contentHash(block.text),
        charsBefore: block.text.length,
        charsAfter: counterpart.text.length,
        removed: snippet.removed,
        added: snippet.added,
      })
    }
  }
  return changed
}

/**
 * 造一个改写流水账。
 *
 * 正式运行由 durable 提供 Host 持久存储；读取与可选旧属性表、进程内结果合并。
 * durable 写失败会传播，旧属性表失败仅影响索引副本，不否认 Host 已确认的写入。
 *
 * @param {object} deps
 * @param {() => object|undefined} deps.store 取索引插件服务;每次现取(它可能晚于本插件注册)。
 * @param {{put: Function, list: Function}} [deps.durable] Host 持久写入及 ACK 后读取；正式 runtime 提供。
 * @param {(message: string) => void} [deps.warn] 旧属性表的诊断输出。
 * @returns {{record: Function, list: Function}} 记录与查询。
 */
export function createRewriteJournal({ store, durable, warn = () => {} }) {
  /** 进程内的那份。sessionId → 记录数组。 */
  const memory = new Map()

  return {
    // 供 HTTP 诊断确认当前进程实际加载了 wire 格式解析，不以磁盘修改时间推断。
    format: 'wire-v1',
    /**
     * 记一次改写。
     *
     * 先等待 Host 持久写入，再写可选索引副本；Host 失败传播，不能用内存结果掩盖失败。
     *
     * @param {object} entry 记录内容。
     * @returns {Promise<{persisted: boolean}>} 是否由 Host 或旧属性表确认持久化。
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
          removed: entry.removed,
          added: entry.added,
          at: entry.at ?? Date.now(),
        },
        origin: 'plugin',
        visibility: 'user',
      }
      const bucket = memory.get(row.sessionId) ?? []
      bucket.push(row)
      memory.set(row.sessionId, bucket)

      // Runtime always supplies the Host journal. A write failure propagates and remains visible through flush.
      if (durable) await durable.put(row.value)
      const service = store()
      if (service === undefined || typeof service.putAttribute !== 'function') return { persisted: Boolean(durable) }
      try {
        const id = await service.putAttribute(row)
        return { persisted: Boolean(durable) || typeof id === 'string' }
      } catch (error) {
        warn((durable ? 'context-care: 索引副本写入失败，Host 已确认持久化: ' : 'context-care: 改写记录没写进属性表,只留在进程内: ') + (error instanceof Error ? error.message : String(error)))
        return { persisted: Boolean(durable) }
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
      if (durable) for (const value of await durable.list(sessionId)) rows.push({ hash: value.hash, value })
      const service = store()
      // 旧客户端接口仍读取所有会话；实际卡片按 sessionId + hash 匹配，保持会话隔离。
      if (service !== undefined && typeof service.listAttributes === 'function') {
        try {
          const query = { namespace: NAMESPACE, name: REWRITE_NAME }
          if (sessionId !== undefined) query.sessionId = sessionId
          const stored = await service.listAttributes(query)
          for (const item of stored) rows.push({ hash: item.value?.hash, value: { ...item.value, sessionId: item.sessionId } })
        } catch (error) {
          warn((durable ? 'context-care: 旧索引读取失败，仍返回 Host 持久记录: ' : 'context-care: 读属性表失败,只返回进程内的记录: ') + (error instanceof Error ? error.message : String(error)))
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
