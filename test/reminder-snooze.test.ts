import test from 'node:test'
import assert from 'node:assert/strict'
import { readSnoozeResult, snoozeOutput, snoozeResult } from '../src/reminder-runtime/snooze.ts'

const windows = [{ sourceId: 'night', ruleId: 'rest', key: '["night","rest","model","2026-10-22"]', until: 1792648800000 }]

test('snooze retains exact selected window identities in both native result paths', () => {
  const value = snoozeResult('session', windows)
  const content = snoozeOutput.render({}, value)
  assert.deepEqual(readSnoozeResult(content, undefined), value)
  assert.deepEqual(readSnoozeResult([], snoozeOutput.presentationMeta?.({}, value)), value)
  assert.match(value.summary, /1 条/)
  assert.deepEqual(readSnoozeResult(content, { ...value, windows: [] }), { ...value, windows: [] }, 'native metadata takes precedence')
})

test('snooze never invents identities from legacy prose or malformed output', () => {
  const legacyCases: readonly unknown[][] = [
    [{ type: 'text', text: '已暂停 1 条当前窗口提醒，窗口结束后自动恢复。' }],
    [{ type: 'text', text: JSON.stringify({ ...snoozeResult('session', windows), windows: [{ ...windows[0], key: '' }] }) }],
    [{ type: 'reasoning', text: JSON.stringify(snoozeResult('session', windows)) }],
    [null, [], { type: 'text', text: 1 }],
  ]
  for (const content of legacyCases) assert.equal(readSnoozeResult(content, undefined), undefined)
  assert.deepEqual(readSnoozeResult([{ type: 'text', text: JSON.stringify(snoozeResult('session', [])) }], null)?.windows, [])
})
