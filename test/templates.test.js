import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTemplates } from '../src/templates.js'

test('prompt rendering is strict, literal and single-pass', () => {
  const templates = createTemplates()
  assert.equal(templates.render('{{captures.value}}', { captures: { value: '{{vars.missing}} <&>' } }), '{{vars.missing}} <&>')
  assert.throws(() => templates.render('{{vars.missing}}', { vars: {} }), /not defined/)
  assert.throws(() => templates.render('{{lookup vars "key"}}', { vars: {} }), /helper-unavailable/)
  assert.throws(() => templates.render('{{vars.__proto__}}', { vars: {} }), /dangerous-path/)
})
test('bounded loops and named partials reject runaway output and recursion', () => {
  const templates = createTemplates({ maxIterations: 2, maxPartialDepth: 2, maxOutputChars: 12 })
  assert.throws(() => templates.render('{{#each items}}{{this}}{{/each}}', { items: [1, 2, 3] }), /loop-budget/)
  templates.registerPartial({ name: 'loop', revision: 1, template: '{{> loop}}' })
  assert.throws(() => templates.render('{{> loop}}', {}), /partial-depth/)
  assert.throws(() => templates.render('{{value}}', { value: 'a'.repeat(13) }), /output-too-large/)
  const dispose = templates.registerPartial({ name: 'text', revision: 1, template: 'ok' })
  assert.equal(templates.render('{{> text}}', {}), 'ok'); dispose()
  assert.throws(() => templates.render('{{> text}}', {}), /could not be found/)
})
test('typed inputs stay JSON values and do not interpret captured shell characters', () => {
  const templates = createTemplates()
  const result = templates.bind({ argv: ['script', { bind: 'captures.value' }], count: { bind: 'vars.count' } }, { captures: { value: 'x; $(abc)' }, vars: { count: 2 } })
  assert.deepEqual(result.argv, ['script', 'x; $(abc)']); assert.equal(result.count, 2)
})

test('data paths cannot execute functions or getters, including unused nested values', () => {
  const templates = createTemplates(); let invoked = 0
  const callable = { vars: { value: () => { invoked++; return 'executed' } } }
  const accessor = { vars: {} }
  Object.defineProperty(accessor.vars, 'value', { enumerable: true, get() { invoked++; return 'executed' } })
  assert.throws(() => templates.render('{{vars.value}}', callable), /snapshot-requires-json/)
  assert.throws(() => templates.render('Literal template', accessor), /snapshot-accessor-denied/)
  assert.throws(() => templates.bind({ bind: 'vars.value' }, callable), /snapshot-requires-json/)
  const array = []
  Object.defineProperty(array, '0', { enumerable: true, get() { invoked++; return 'executed' } })
  assert.throws(() => templates.render('{{#each vars.values}}{{this}}{{/each}}', { vars: { values: array } }), /snapshot-accessor-denied/)
  assert.equal(invoked, 0)
  for (const value of [new Date(), new Map(), 1n, Infinity, { [Symbol('hidden')]: 1 }, Object.create({ inherited: 'text' })])
    assert.throws(() => templates.render('Literal', { vars: { value } }), /snapshot-requires-json/)
  assert.throws(() => templates.render('{{vars.value}}', { vars: JSON.parse('{"__proto__":{"value":"hidden"}}') }), /dangerous-property/)
})

test('disabled helpers and template directives cannot be enabled by declarations', () => {
  const templates = createTemplates()
  for (const name of ['lookup', 'log', 'helperMissing', 'blockHelperMissing']) {
    assert.throws(() => templates.render(`{{${name}}}`, {}), /helper-unavailable/)
    assert.throws(() => templates.registerHelper({ name, revision: 1, render: () => '' }), /helper-conflict/)
  }
  assert.throws(() => templates.render('{{unknown value="x"}}', {}), /helper-unavailable/)
  assert.throws(() => templates.render('{{> (vars.partial)}}', { vars: { partial: 'name' } }), /dynamic-partial/)
  assert.throws(() => templates.render('{{#> name}}Body{{/name}}', {}), /unsupported-directive/)
  assert.throws(() => templates.render('{{#*inline "name"}}Body{{/inline}}', {}), /unsupported-directive/)
})

test('reminder declarations support readable variables, conditions, loops and named templates', () => {
  const templates = createTemplates()
  templates.registerPartial({ name: 'reminder', revision: 1, template: '请核对 {{vars.label}}：{{captures.[0]}}。' })
  const snapshot = { vars: { label: '当前任务', mode: 'continue', items: ['原始要求', '验证结果'] }, captures: ['<&> {{vars.other}}'] }
  assert.equal(templates.render('{{> reminder}}\n{{#if (eq vars.mode "continue")}}继续工作。{{else}}等待说明。{{/if}}\n{{#each vars.items as |item|}}{{@index}}: {{item}}\n{{/each}}', snapshot),
    '请核对 当前任务：<&> {{vars.other}}。\n继续工作。\n0: 原始要求\n1: 验证结果\n')
  assert.equal(templates.render('{{json vars.items}}', snapshot), '["原始要求","验证结果"]')
  const dispose = templates.registerHelper({ name: 'upper', revision: 1, render: value => value.toUpperCase() })
  assert.equal(templates.fork().render('{{upper vars.label}}', { vars: { label: 'hello' } }), 'HELLO')
  dispose()
  assert.throws(() => templates.render('{{upper vars.label}}', { vars: { label: 'hello' } }), /Missing helper|not defined|helper-unavailable/)
})
