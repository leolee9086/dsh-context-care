import { randomUUID } from 'node:crypto'
import { createUserMessage } from './message.js'
import { CHECKPOINT_KIND } from './producer-source.js'

/**
 * 清空式压缩：把选中的 surface 区间换成一条交接，不调用模型。
 *
 * 与摘要路径的差别只有替换物的来源。摘要是另起一次 LLM 调用生成的，
 * 而那个调用的任务是"保留所有重要信息"，于是它必然产出几千 token —— 区间一旦缩到
 * 同量级，`framedSummaryTokenCount >= shadowedRouteTokenCount` 就永远成立，
 * 压缩永久失败（DSH 的 compaction-basic 就卡在这里）。
 *
 * 交接与找回路径构成完整替换消息；在同一输入计价依据下必须小于所选历史。
 * 旧正文仍保存在日志，replacement 的 shadow 记录固定 heuristic 成本。
 */

/** 会话当前的边界状态，全部由日志推出，不依赖任何 compaction 服务。 */
export function inspectSession(session) {
  let openTurn = null
  let unmatchedCompactionStart
  const events = session.snapshotEvents()
  for (const event of events) {
    if (event.type === 'turn/start') {
      openTurn = event.data.turn
    } else if (event.type === 'turn/end') {
      openTurn = null
    } else if (event.type === 'compaction/start') {
      unmatchedCompactionStart = event.seq
    } else if (event.type === 'compaction/end') {
      unmatchedCompactionStart = undefined
    }
  }
  return { openTurn, unmatchedCompactionStart }
}

/** 交接消息在 surface 上的来源标记；与 DSH 的 checkpoint 约定一致（V3 的 `compact` 迁移后就是它）。 */
function checkpointSource(compactionId) {
  return { kind: CHECKPOINT_KIND, compactionId }
}

/**
 * 用一段文本替换一个 surface 区间，走完整的 compaction 事务。
 *
 * 事件序列与 invariant 的要求一致：start → summary → replace → end，
 * 四处 compactionId 相同，`shadowedSeqs` 精确列出当前 surface 上那段区间，
 * owner 取自日志推出的 open turn。取区间、测量、写事件之间不 await ——
 * 中间一旦让出，surface 就可能变，`shadowedSeqs` 便不再匹配。
 *
 * @param session - 被清空的会话。
 * @param meter - `ctx.tokenMeter`，用于给被清区间定价。
 * @param range - `selectClearRange` 的结果：start、end、shadowedSeqs。
 * @param text - 替换物正文（交接 + 找回路径）。
 * @param pricing - 本次维护固定的输入计价，省略时由 meter 独立捕获。
 * @returns 本次事务的 compactionId 与被清掉的 token 数。
 */
export function clearRange(session, meter, range, text, pricing) {
  const { openTurn, unmatchedCompactionStart } = inspectSession(session)
  if (unmatchedCompactionStart !== undefined) {
    throw new Error('context-care: another compaction is already open on this session')
  }

  // The started-action durability ACK may have yielded since selection. Refuse
  // a stale or noncontiguous prefix before opening a replacement transaction.
  const nodes = session.surface.nodes
  const start = nodes.indexOf(range.start)
  const end = nodes.indexOf(range.end)
  const current = start < 0 || end < start ? [] : nodes.slice(start, end + 1)
  if (current.length !== range.shadowedSeqs.length || current.some((seq, index) => seq !== range.shadowedSeqs[index])) {
    throw new Error('context-care: handoff source changed; history retained')
  }
  const measurement = pricing === undefined ? meter.measureInput(session) : pricing.measure()
  const priced = new Map(measurement.nodes.map(node => [node.seq, node.heuristicTokens]))
  const selected = new Set(range.shadowedSeqs)
  const selectedTokens = measurement.nodes.filter(node => selected.has(node.seq)).reduce((sum, node) => sum + node.tokens, 0)
  const content = [{ type: 'text', text }]
  const compactionId = randomUUID()
  const replacement = createUserMessage({ content, source: checkpointSource(compactionId) })
  const replacementTokens = pricing === undefined
    ? meter.priceMessages([replacement], measurement.pricingBasis) : pricing.priceMessages([replacement])
  if (replacementTokens >= selectedTokens) {
    throw new Error('context-care: handoff-larger-than-history; history retained')
  }
  let shadowedTokenCount = 0
  for (const seq of range.shadowedSeqs) {
    const tokens = priced.get(seq)
    if (tokens === undefined) {
      throw new Error('context-care: token measurement does not match the current surface')
    }
    shadowedTokenCount += tokens
  }

  const config = session.requestHeader()?.config
  const startEvent = session.append('compaction/start', { compactionId, turn: openTurn })
  let summaryEvent
  try {
    summaryEvent = session.append('compaction/summary', {
      compactionId,
      summary: content,
      shadowedRange: { start: range.start, end: range.end },
      shadowedSeqs: [...range.shadowedSeqs],
      shadowedTokenCount,
      provider: config?.provider ?? '',
      model: config?.model ?? '',
    })
    session.append('user/message', replacement, {
      surfaceOp: { op: 'replace', startSeq: range.start, endSeq: range.end },
      sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...range.shadowedSeqs],
    })
  } catch (error) {
    // 失败也要闭合事务，否则这个会话再也开不了新的压缩（未匹配的 start 会挡住）。
    try {
      session.append('compaction/end', {
        compactionId,
        turn: openTurn,
        error: error instanceof Error ? error.message : String(error),
      })
    } catch (closeError) { void closeError } // Preserve the failure; the unmatched start remains observable.
    throw error
  }
  session.append('compaction/end', { compactionId, turn: openTurn })
  return { compactionId, shadowedTokenCount }
}
