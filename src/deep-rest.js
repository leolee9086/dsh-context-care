import { randomUUID } from 'node:crypto'
import { createUserMessage } from './message.js'

/**
 * 清空式压缩：把选中的 surface 区间换成一条交接，不调用模型。
 *
 * 与摘要路径的差别只有替换物的来源。摘要是另起一次 LLM 调用生成的，
 * 而那个调用的任务是"保留所有重要信息"，于是它必然产出几千 token —— 区间一旦缩到
 * 同量级，`framedSummaryTokenCount >= shadowedRouteTokenCount` 就永远成立，
 * 压缩永久失败（DSH 的 compaction-basic 就卡在这里）。
 *
 * 清空用模型自己写的东西当替换物，所以不存在那个下界：交接再长也远小于被清掉的历史。
 * 代价是细节真的离开眼前了 —— 这就是为什么 recovery 必须由模型填写，
 * 它是清空后唯一能走回去的路径。
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

/** 交接消息在 surface 上的来源标记；与 DSH 的 checkpoint 约定一致。 */
function checkpointSource(compactionId) {
  return { kind: 'plugin', plugin: 'compact', compactionId }
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
 * @returns 本次事务的 compactionId 与被清掉的 token 数。
 */
export function clearRange(session, meter, range, text) {
  const { openTurn, unmatchedCompactionStart } = inspectSession(session)
  if (unmatchedCompactionStart !== undefined) {
    throw new Error('context-care: another compaction is already open on this session')
  }

  const measurement = meter.measure(session)
  const priced = new Map(measurement.nodes.map(node => [node.seq, node.tokens]))
  let shadowedTokenCount = 0
  for (const seq of range.shadowedSeqs) {
    const tokens = priced.get(seq)
    if (tokens === undefined) {
      throw new Error('context-care: token measurement does not match the current surface')
    }
    shadowedTokenCount += tokens
  }

  const config = session.requestHeader()?.config
  const compactionId = randomUUID()
  const content = [{ type: 'text', text }]
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
    session.append('user/message', createUserMessage({ content, source: checkpointSource(compactionId) }), {
      surfaceOp: { op: 'replace', startSeq: range.start, endSeq: range.end },
      sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...range.shadowedSeqs],
    })
  } catch (error) {
    // 失败也要闭合事务，否则这个会话再也开不了新的压缩（未匹配的 start 会挡住）。
    session.append('compaction/end', {
      compactionId,
      turn: openTurn,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  session.append('compaction/end', { compactionId, turn: openTurn })
  return { compactionId, shadowedTokenCount }
}
