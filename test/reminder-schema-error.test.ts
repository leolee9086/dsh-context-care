import test from 'node:test'
import assert from 'node:assert/strict'
import { compileRule } from '../lib/reminder-runtime/schema.js'
import { compileReminderCondition } from '../lib/reminder-runtime/conditions.js'

/** A v4 rule whose only fault is an unknown top-level field. */
const rule = (extra: Record<string, unknown> = {}) => ({ format: 'reminder/v4', id: 'r', on: 'tool.succeeded',
  text: 't', when: { tool: 'read' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } }, ...extra })

function capture(fn: () => unknown): Error {
  try { fn() }
  catch (error) { assert.ok(error instanceof Error); return error }
  throw new Error('expected a rejection')
}

test('解析失败的报告是普通 Error，结构化克隆后消息仍然可读', () => {
  const error = capture(() => compileRule(rule({ typo: true })))
  // Zod v4 keeps `message` as an accessor, which structured clone drops entirely;
  // the boundary conversion is what keeps a relayed rejection diagnosable.
  assert.equal(error.constructor, Error)
  assert.match(error.message, /提醒规则无效/)
  assert.match(error.message, /typo/)
  const relayed = structuredClone(error)
  assert.ok(relayed.message.length > 0)
  assert.match(relayed.message, /typo/)
  // The structured issues survive as the cause for callers that want them.
  assert.ok(error.cause !== undefined)
})

test('条件与规则两级报告都带上出错字段的路径', () => {
  const ruleError = capture(() => compileRule(rule({ when: { tool: 'read', arguments: { a: { regex: '[' } } } })))
  assert.match(ruleError.message, /when|arguments|regex/)
  const conditionError = capture(() => compileReminderCondition({ kind: 'compare', field: 'x', op: 'nope' }))
  assert.match(conditionError.message, /提醒条件无效/)
  assert.equal(structuredClone(conditionError).message.length > 0, true)
})

test('合法的空条件组合与正常规则不受影响', () => {
  // A rule with no extra condition compiles to an empty all-group, which matches everything.
  assert.equal(compileReminderCondition({ kind: 'all', conditions: [] }).kind, 'all')
  assert.equal(compileRule(rule()).on, 'tool.succeeded')
})
