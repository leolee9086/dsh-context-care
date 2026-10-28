import { createTemplates, importWorkbench, createBoundedMatcher, planDisplay as planDisplayV2 } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'

const script = extra => ({ id: 'sample', scriptName: 'Capture replacement', findRegex: '/(?<letter>[ab])/g', replaceString: '$<letter>:$0:$1:{{match}}',
  placement: [2], markdownOnly: true, disabled: false, ...extra })

test('Tavern regex converts independent global captures and display copies without editing raw blocks', async () => {
  const templates = createTemplates(); const imported = importWorkbench(script(), templates)
  assert.equal(imported.importer.format, 'tavern-regex')
  const rules = imported.document.rules.map(rule => ({ ...rule, sourceId: 'source' }))
  const block = { id: 'b', view: 'display', sessionId: 's', seq: 1, messageId: 'm', turnId: 't', role: 'assistant', type: 'text', path: '0', text: 'ab' }
  const matcher = createBoundedMatcher()
  try {
    const { normalizeRuleV2 } = await import('@leolee9086/dsh-rule-engine')
    const normalized = rules.map(normalizeRuleV2)
    const events = await matcher.detect({ rules: normalized, blocks: [block], stage: 'display.render' })
    const planned = planDisplayV2({ blocks: [block], rules: normalized, events, templates, snapshot: {}, decision: () => ({ enabled: true }), maxInjectedChars: 65536, maxBytes: 100000 })
    assert.equal(planned.after[0].text, 'a:a:a:ab:b:b:b')
    assert.equal(block.text, 'ab')
    assert.equal(events.length, 1, 'a sequential text program receives the block once')
    assert.ok(imported.report.some(row => row.status === 'converted' && /ordered text transformations/.test(row.message)))
  } finally { await matcher.close() }
})

test('Tavern regex retains macro depth trim history and sticky matching scripts in one shared model', () => {
  const scripts = [script(), script({ id: 'macro', substituteRegex: 1 }), script({ id: 'depth', maxDepth: 2 }),
    script({ id: 'trim', trimStrings: ['x'] }), script({ id: 'history', markdownOnly: false }),
    script({ id: 'unknown', unexpected: 'kept in report', findRegex: '/a/y' }), script({ id: 'placement', placement: [3] })]
  const imported = importWorkbench({ name: 'Compatibility', regexScripts: scripts }, createTemplates())
  assert.equal(imported.document.rules.length, 6)
  assert.ok(imported.report.some(row => row.path.endsWith('.unexpected') && row.status === 'unsupported'))
  assert.ok(imported.report.some(row => row.path.endsWith('.placement') && row.status === 'rejected'))
  for (const field of ['substituteRegex', 'trimStrings', 'markdownOnly', 'findRegex']) assert.equal(imported.report.some(row => row.path.endsWith(`.${field}`) && row.status === 'rejected'), false)
  const both = importWorkbench(script({ markdownOnly: true, promptOnly: true, placement: [1, 2, 6] }), createTemplates())
  assert.equal(both.document.rules.length, 6)
  assert.equal(both.document.rules.filter(rule => rule.select.blockTypes.includes('reasoning')).length, 2)
})
