// src/loop-clean-projection.js — 循环清理的决策事件与纯投影。
//
// 为什么要走投影(2026-09-23 查明的根因):
// 清理原来写在 agent/pre-step 里改 decision.messages,但那够不着 ——
// pre-step 的 messages 是本轮**新领取的输入**(inbox.claim 的结果,事件签名把她
// 写死成 UserMessage[],见 DSH 的 core/agent/src/runtime-types.ts:320),
// 它们随后被 append 成 user/message(agent-loop/src/agent.ts:374-377)。
// 里面没有、也不会有上一轮的助手输出 —— 而循环恰恰长在那上面。
// 所以那段清理从挂上去的第一天起就不可能命中:cleanMessages 找 role === 'assistant'
// 永远找不到,removedLines 恒为 0。
//
// DSH 给「插件改已有消息的模型可见内容」提供的机制是消息投影。同构的现成范例是
// compaction-image-offload 的图片卸载(它把历史里的图片块换成占位文字):
//   · 插件 append 一条自己拥有的决策事件;
//   · 插件注册一个纯解释器,fold 到那条事件时把它要改的消息交出来;
//   · 日志原文不动,deriveMessages() 返回投影后的版本。
// 这样「模型看到的」和「日志里记的」各归各位,重建会话时也能重放出同样的结果。
//
// 投影必须是纯函数:同一个输入必须产出同一个结果。不然会话重建会漂,
// 前缀缓存也会每轮都废一次。清理本身已经幂等(见 loop-clean.js 的 cleanTail)。

import { cleanMessage } from './loop-clean.js'

/** 事件类型名。带包名前缀,跟 context-care/transform 一个风格。 */
export const LOOP_CLEAN_EVENT = 'context-care/loop-clean'

/**
 * 递归冻结。已经是冻结的就直接返回 —— 消息里的块大多共享自已冻结的原件,
 * 提前返回能把这次遍历压到只有新造的那几个对象上。
 *
 * @param {*} value 要冻结的值。
 * @returns {*} 同一个值。
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return value
}

/**
 * 读出 data 里的 targets。形状不对就抛错,不猜。
 *
 * 事件是持久数据,重建会话时会被重新读一遍 —— 静默跳过一条写坏的决策,
 * 等于让模型看到一份和日志对不上的历史。
 *
 * @param {*} data 事件的 data。
 * @returns {Array<{seq: number, ruleId: string}>} targets。
 */
function readTargets(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${LOOP_CLEAN_EVENT}: data 必须是对象`)
  }
  const keys = Object.keys(data)
  if (keys.length !== 1 || keys[0] !== 'targets') {
    throw new Error(`${LOOP_CLEAN_EVENT}: data 只能有 targets`)
  }
  const targets = data.targets
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(`${LOOP_CLEAN_EVENT}: targets 必须是非空数组`)
  }
  const seen = new Set()
  for (const target of targets) {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) {
      throw new Error(`${LOOP_CLEAN_EVENT}: 每个 target 必须是对象`)
    }
    const targetKeys = Object.keys(target).sort()
    if (targetKeys.length !== 2 || targetKeys[0] !== 'ruleId' || targetKeys[1] !== 'seq') {
      throw new Error(`${LOOP_CLEAN_EVENT}: 每个 target 只能有 seq 和 ruleId`)
    }
    if (!Number.isSafeInteger(target.seq) || target.seq < 0) {
      throw new Error(`${LOOP_CLEAN_EVENT}: target.seq 必须是非负安全整数`)
    }
    if (typeof target.ruleId !== 'string' || target.ruleId.length === 0) {
      throw new Error(`${LOOP_CLEAN_EVENT}: target.ruleId 必须是非空字符串`)
    }
    if (seen.has(target.seq)) throw new Error(`${LOOP_CLEAN_EVENT}: seq ${target.seq} 重复出现`)
    seen.add(target.seq)
  }
  return targets
}

/**
 * 把决策事件指的助手输出换成清理版。
 *
 * 契约(跟 DSH 的消息投影一致):纯函数。不改日志、不改传进来的任何对象,
 * 只返回一张 `seq → 新消息` 的表;表里没有的 seq 就当没动过。
 *
 * seq 必须是**当前** surface 节点,而且源事件必须是 assistant/message ——
 * 指错了就是决策写错了,直接抛错。
 *
 * @param {object} event 决策事件。
 * @param {object} context `{ nodes, events, baseSeq, messages }`。
 * @returns {Map<number, object>} seq → 清理后的消息;没得清就不放进去。
 */
export const loopCleanProjection = {
  type: LOOP_CLEAN_EVENT,
  project(event, context) {
    const targets = readTargets(event.data)
    const nodes = new Set(context.nodes)
    const out = new Map()
    for (const target of targets) {
      if (!nodes.has(target.seq)) {
        throw new Error(`${LOOP_CLEAN_EVENT}: seq ${target.seq} 不是当前 surface 节点`)
      }
      const source = context.events[target.seq - context.baseSeq]
      if (source?.type !== 'assistant/message') {
        throw new Error(`${LOOP_CLEAN_EVENT}: seq ${target.seq} 不是 assistant/message`)
      }
      // 已经投影过的版本优先 —— 同一个 seq 上叠了别的决定时,要接着那一份改。
      const message = context.messages.get(target.seq) ?? source.data.message
      const cleaned = cleanMessage(message)
      // 没得清说明已经清过了(幂等),不往表里放 —— 放了反而会让重建漂。
      if (cleaned.removedLines === 0) continue
      // 决策记下的模式和实际命中的模式必须一致。对不上说明这条决策
      // 不是针对这份内容的,照它改就是拿错模板去改别人的日志。
      if (cleaned.pattern !== target.ruleId) {
        throw new Error(`${LOOP_CLEAN_EVENT}: seq ${target.seq} 实际命中 ${cleaned.pattern},决策记的是 ${target.ruleId}`)
      }
      out.set(target.seq, deepFreeze(cleaned.message))
    }
    return out
  },
}

/**
 * 这一轮要不要清最后一条助手输出?
 *
 * 看的是**当前模型可见的**那一份(`deriveEventMessage` 会带上已有的投影):
 * 已经清过的自然不再命中,所以不会重复落决策、也不会反复废缓存。
 *
 * 只碰最后一条:循环总是刚发生的那一条,往前翻会把正常的历史也改掉。
 *
 * @param {object} session 会话。
 * @returns {{seq: number, ruleId: string, removedLines: number}|undefined} 要清的节点;没有就 undefined。
 */
export function pendingLoopClean(session) {
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes)) return undefined
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const seq = nodes[index]
    const event = session.eventAt(seq)
    if (event?.type !== 'assistant/message') continue
    const message = session.deriveEventMessage(event)
    if (message === null || message === undefined) return undefined
    const cleaned = cleanMessage(message)
    if (cleaned.removedLines === 0) return undefined
    return { seq, ruleId: cleaned.pattern, removedLines: cleaned.removedLines }
  }
  return undefined
}
