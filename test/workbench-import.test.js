import test from 'node:test'
import assert from 'node:assert/strict'
import { importWorkbench } from '../src/workbench-import.js'
import { createTemplates } from '../src/templates.js'
import { detectRulesV2 } from '../src/vendor/rule-engine/index.js'
import { entryRule } from '../src/workbench-store.js'
const templates = createTemplates()
const row = (uid, extra = {}) => ({ uid, key: ['dragon'], content: 'Retain the original facts.', ...extra })
const imported = entries => importWorkbench({ name: 'World', entries }, templates)
const status = (result, path, expected) => assert.ok(result.report.some(field => field.path === path && field.status === expected), JSON.stringify(result.report))

test('World-info retains valid neighbours and reports invalid data, IDs, macros and unsupported depth anchors', () => {
  const result = imported({ good: row(1), null: null, array: [], type: row(true), depth: row(2, { position: 4, depth: 3 }),
    noKeys: { uid: 3, content: 'Cannot activate' }, macro: row(4, { content: '{{user}} saw this.' }), duplicate: row(1), last: row(5, { constant: true, key: [] }) })
  assert.deepEqual(result.document.entries.map(entry => entry.id), ['1', '5'])
  for (const [key, suffix] of [['null', ''], ['array', ''], ['type', '.uid'], ['depth', '.position'], ['noKeys', ''], ['macro', '.content'], ['duplicate', '']])
    status(result, `entries.${key}${suffix}`, 'rejected')
  assert.ok(!result.report.some(field => field.path === 'entries.depth' && field.status === 'converted'))
  assert.deepEqual(result.importer, { format: 'tavern-world-info', version: 1 })
})

test('Every present accepted field has a compatibility report and timing, depth and recursion differences remain explicit', () => {
  const source = row(0, { comment: 'Title', constant: false, keysecondary: ['old'], selective: true, selectiveLogic: 2,
    disable: true, order: 4, position: 0, depth: 2, caseSensitive: true, matchWholeWords: true, scanDepth: 4, sticky: 3,
    cooldown: 5, excludeRecursion: false, futureFlag: true })
  const result = imported({ entry: source }); const entry = result.document.entries[0]
  assert.deepEqual(entry.target, { view: 'model', role: 'system', anchor: 'start', position: 'after' })
  assert.equal(entry.enabledDefault, false); assert.equal(entry.cooldownMs, 0)
  assert.equal(entry.activation.secondary.mode, 'NOT-ANY')
  for (const field of Object.keys(source)) assert.ok(result.report.some(item => item.path === `entries.entry.${field}`), field)
  for (const field of ['futureFlag', 'cooldown', 'depth']) status(result, `entries.entry.${field}`, 'unsupported')
  for (const field of ['scanDepth', 'sticky', 'excludeRecursion']) status(result, `entries.entry.${field}`, 'difference')
  const after = imported({ after: row('after', { position: 1 }) })
  assert.equal(after.document.entries[0].target.anchor, 'end')
})

test('Secondary keyword logic uses the same native matcher and constant entries do not retain inactive secondary activation', () => {
  const result = imported({ secondary: row('secondary', { selective: true, keysecondary: ['old'], selectiveLogic: 2 }),
    constant: row('constant', { constant: true, selective: true, keysecondary: ['old'], selectiveLogic: 3 }) })
  const rules = result.document.entries.map(entry => entryRule(result.document, entry))
  const blocks = text => [{ id: 'b', seq: 1, messageId: 'm', turnId: 't', role: 'user', view: 'model', type: 'text', text }]
  assert.deepEqual(detectRulesV2({ rules, blocks: blocks('dragon old'), stage: 'request.assemble' }).map(event => event.ruleId), ['entry:constant'])
  assert.deepEqual(detectRulesV2({ rules, blocks: blocks('dragon'), stage: 'request.assemble' }).map(event => event.ruleId), ['entry:constant', 'entry:secondary'])
  status(result, 'entries.constant.keysecondary', 'difference')
})

test('World-info entry limits reject excess entries without rejecting the document, native input remains strict', () => {
  const entries = Object.fromEntries(Array.from({ length: 258 }, (_, i) => [String(i), row(i)]))
  const result = imported(entries)
  assert.equal(result.document.entries.length, 256)
  status(result, 'entries.256', 'rejected'); status(result, 'entries.257', 'rejected')
  const native = { schemaVersion: 2, id: 'native', revision: 1, title: 'Native', entries: [] }
  assert.deepEqual(importWorkbench(native, templates).report, [])
  assert.throws(() => importWorkbench({ ...native, unknown: true }, templates))
  assert.throws(() => importWorkbench({ name: 7, entries: {} }, templates))
})
