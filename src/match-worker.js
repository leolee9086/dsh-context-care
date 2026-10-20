import { parentPort } from 'node:worker_threads'
import { detectRulesV2 } from '@leolee9086/dsh-rule-engine'
import { executeReminderMatch, executeReminderBatch } from '../lib/reminder-runtime/matcher.js'
import { assertDetectorJson } from './detector-protocol.js'
import { createWorkerDetectors } from './detector-worker.js'

/**
 * 线程上可能同时排着好几个任务，每条响应都要带回任务 id：
 * 主线程靠它把结果交回发起那条任务的调用方，而不是交给最近的一个。
 */
async function handle(input) {
  const taskId = input?.taskId
  try {
    parentPort.postMessage({ started: true, taskId })
    if (input.warmup) return parentPort.postMessage({ taskId, result: null })
    if (input.analysis) {
      const { analyzer, event, maxBytes } = input.analysis
      const module = await import(analyzer.module)
      if (typeof module[analyzer.exportName] !== 'function') throw new Error('reminder-analyzer-export-missing')
      const facts = await module[analyzer.exportName]({ event, context: event.context ?? { messages: [], truncated: false } })
      assertDetectorJson(facts)
      if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) throw new Error('reminder-analysis-requires-facts-object')
      if (Buffer.byteLength(JSON.stringify(facts)) > maxBytes) throw new Error('reminder-analysis-budget-exceeded')
      return parentPort.postMessage({ taskId, result: facts })
    }
    if (input.reminder) return parentPort.postMessage({ taskId, result: await executeReminderMatch(input.reminder) })
    if (input.reminderBatch) {
      // 一次投递算多条规则：事件只序列化一次，这是批量的全部收益。
      // 但每条算完就单独上报一条——批量只是输入合在一起，结局各自独立。
      return parentPort.postMessage({ taskId, result: await executeReminderBatch(input.reminderBatch,
        item => parentPort.postMessage({ taskId, item })) })
    }
    const { taskId: _omit, ...payload } = input
    if (!payload.detectorSpecifications) return parentPort.postMessage({ taskId, result: detectRulesV2(payload) })
    const detectors = createWorkerDetectors(payload.detectorSpecifications, payload.detectorStates)
    if (payload.detectorReset) {
      detectors.reset(payload.detectorReset)
      return parentPort.postMessage({ taskId, result: { events: [], states: {} } })
    }
    return parentPort.postMessage({ taskId, result: { events: detectRulesV2({ ...payload, detectorMatch: detectors.match }), states: detectors.updated } })
  } catch (error) {
    // 端口已经关掉时连错误都发不出去；那也只是一次失败的汇报，不该变成未处理拒绝。
    try { parentPort.postMessage({ taskId, error: { name: error.name, message: error.message } }) }
    catch { /* 线程要死了，没有收件人了 */ }
  }
}

// 一个线程一次只算一件事：任务靠这条链严格排队，主线程才知道「正在跑的是哪一条」，
// 卡死时也才能精确地只判它超时，而不是把整条线程上的任务一起算成失败。
let queue = Promise.resolve()
parentPort.on('message', input => {
  // 一次处理失败不能让整条线程罢工：链条一旦断掉，之后每条任务都会被静默跳过，
  // 主线程只能等满一个超时才把它 kill 重投。所以每一步都就地收掉自己的错误。
  queue = queue.then(() => handle(input), () => handle(input)).catch(() => {})
})
parentPort.postMessage({ ready: true })
