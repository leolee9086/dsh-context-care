import { createDisplayPlanCache, indexDisplayBlocks, mergeDisplayInsertions, planDisplay as planDisplayV2, normalizeRuleV2, type V2Action, type RuleEvent, type NormalizedRuleV2 } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionCache } from '../lib/session-cache.js'

const block = (id: string, path = '0', extra = {}) => ({ id, path, view: 'display', role: 'assistant', type: 'text', text: 'BASE', raw: { type: 'text', text: 'BASE' }, ...extra })
const action = (id: string, dependsOn: string[] = [], extra: Partial<V2Action> = {}): V2Action => ({ id, dependsOn, stage: 'display.render', kind: 'inject', template: id,
  enabledDefault: true, cooldownMs: 0, dedupe: { mode: 'none' }, target: { view: 'display', anchor: 'end' }, ...extra })
const baseRule = normalizeRuleV2({ schemaVersion: 2, sourceId: 's', id: 'r', revision: 1, on: ['display.render'], select: { view: 'display', roles: ['assistant'], blockTypes: ['text'] },
  match: { kind: 'always' }, actions: [action('base')] })
// Cycles and missing dependencies deliberately bypass declaration validation to exercise planning failures.
const rule = (actions: V2Action[], extra: Partial<NormalizedRuleV2> = {}): NormalizedRuleV2 => ({ ...baseRule, actions, ...extra })
const event = (occurrenceId: string, extra: Partial<RuleEvent> = {}): RuleEvent => ({ schemaVersion: 2, sourceId: 's', ruleId: 'r', ruleRevision: 1, occurrenceId,
  stage: 'display.render', view: 'display', coordinate: 'utf16', sourceSeqs: [], blockId: 'b', ranges: [], captures: {}, facts: {}, block: block('b'), ...extra })
const options = () => ({ blocks: [block('b')], rules: [rule([action('caption')])], events: [event('e')], snapshot: {}, templates: { render: (source: string) => source },
  decision: () => ({ enabled: true }), maxInjectedChars: 65536, maxBytes: 100000 })

test('display insertion merge matches descending splice including duplicate ties and priorities', () => {
  const baseline = Array.from({ length: 1000 }, (_, index) => ({ id: `b:${index}`, text: String(index) }))
  const inserts = Array.from({ length: 2000 }, (_, index) => ({ at: index % 2 ? 500 : index % 1001, priority: index % 5, block: { id: `same:${index % 13}`, text: `insert:${index}` } }))
  const original = [...baseline]
  for (const insertion of [...inserts].sort((a, b) => b.at - a.at || a.priority - b.priority || b.block.id.localeCompare(a.block.id))) original.splice(insertion.at, 0, insertion.block)
  assert.deepEqual(mergeDisplayInsertions(baseline, inserts), original)
  assert.equal(baseline.length, 1000); assert.equal(inserts.length, 2000)
  assert.deepEqual(mergeDisplayInsertions([], [{ at: 0, priority: 0, block: { id: 'only', text: 'only' } }]), [{ id: 'only', text: 'only' }])
})

test('display lookup keeps first display id and path-only filtering with exact baseline order', () => {
  const duplicate = block('same', '9'), first = block('same', '0')
  const rows = [block('same', '0', { view: 'original' }), first, block('nested', '0.1'), block('prefix', '01.1'), duplicate,
    block('deep', '0.1.0'), block('other-message', '0.2', { messageId: 'other' }), block('result', '$result'), block('empty', ''), block('dot', '.0')]
  const indexed = indexDisplayBlocks(rows)
  assert.equal(indexed.first('same'), first); assert.equal(indexed.position('same'), 0)
  assert.equal(indexed.first('missing'), undefined); assert.equal(indexed.position('missing'), -1)
  for (const selected of indexed.baseline) {
    const original = indexed.baseline.filter(candidate => candidate.id === selected.id || selected.path === '$result' || candidate.path.startsWith(selected.path + '.'))
    assert.deepEqual(indexed.filterGroup(selected), original)
  }
  assert.deepEqual(indexed.filterGroup(first).map(row => row.id), ['same', 'nested', 'same', 'deep', 'other-message'])
  assert.deepEqual(indexed.filterGroup(rows[7]), indexed.baseline)
})

test('display repeated anchors and filters do not rescan an immutable block cut', () => {
  let ids = 0, paths = 0
  const parent = block('parent', '0')
  const rows = [parent, ...Array.from({ length: 1000 }, (_, index) => ({
    get id() { ids++; return `b:${index}` }, get path() { paths++; return `0.${index}` }, view: 'display',
  }))]
  const indexed = indexDisplayBlocks(rows), afterBuild = ids
  const group = indexed.filterGroup(parent), afterFilter = paths
  assert.equal(group.length, 1001)
  for (let index = 0; index < 10000; index++) {
    assert.equal(indexed.first(`b:${index % 1000}`), rows[index % 1000 + 1])
    assert.equal(indexed.position(`b:${index % 1000}`), index % 1000 + 1)
    assert.equal(indexed.filterGroup(parent), group)
  }
  assert.equal(ids, afterBuild); assert.equal(paths, afterFilter)
  assert.notEqual(indexDisplayBlocks([...rows]).filterGroup(parent), group, 'an independent cut owns its directory')
})

test('display action structure is reused per operation while outcomes remain per evidence', () => {
  const cache = createSessionCache(), analysis = createDisplayPlanCache(cache), input = options()
  const actions = [action('child', ['parent']), action('parent'), action('free'), action('missing', ['absent'])]
  input.rules = [rule(actions)]; input.events = [event('denied'), event('allowed')]
  const seen: string[] = []
  const planned = planDisplayV2({ ...input, analysis, decision: (e: ReturnType<typeof event>, a: ReturnType<typeof action>) => {
    seen.push(`${e.occurrenceId}:${a.id}`); return { enabled: e.occurrenceId !== 'denied' || a.id !== 'parent', reason: 'paused' }
  } })
  assert.deepEqual(seen, ['denied:parent', 'denied:child', 'denied:free', 'denied:missing', 'allowed:parent', 'allowed:child', 'allowed:free', 'allowed:missing'])
  assert.deepEqual(planned.records.map((record: { status: string }) => record.status), ['skipped', 'skipped', 'planned', 'skipped', 'planned', 'planned', 'planned', 'skipped'])
  assert.equal(cache.report().find(row => row.name === 'display-plan-actions')?.work, 4)
  assert.equal(analysis.blocks(input.blocks), analysis.blocks(input.blocks))
  analysis.close(); assert.deepEqual(cache.report(), []); assert.throws(() => analysis.actions(actions), /display-plan-cache-closed/)
  cache.close()
})

test('display cycles retain executable prefix and an earlier render failure wins', () => {
  const input = options(); input.rules = [rule([action('a', ['b']), action('b', ['a']), action('prefix')])]
  const seen: string[] = []
  assert.throws(() => planDisplayV2({ ...input, decision: (_e: ReturnType<typeof event>, a: ReturnType<typeof action>) => { seen.push(a.id); return { enabled: true } } }), /display-dependency-cycle/)
  assert.deepEqual(seen, ['prefix'])
  assert.throws(() => planDisplayV2({ ...input, templates: { render() { throw new Error('earlier-render-failure') } } }), /earlier-render-failure/)
  input.rules = [rule([action('missing', ['foreign']), action('foreign', [], { stage: 'request.assemble' })])]
  const skipped = planDisplayV2(input), record = skipped.records[0]
  assert.ok('reason' in record); assert.equal(record.reason, 'dependency-not-planned')
})

test('display first rule and anchor semantics survive duplicate identities and original aliases', () => {
  const input = options(), first = block('b'), later = block('b', '1', { text: 'LATER' })
  input.blocks = [block('b', '0', { view: 'original' }), first, later]
  input.rules = [rule([action('first', [], { target: { view: 'display', anchor: 'b', position: 'before' } })]), rule([action('second')])]
  const output = planDisplayV2(input)
  assert.equal(output.after[0].text, 'first'); assert.equal(output.after[1].text, 'BASE'); assert.equal(output.after[2].text, 'LATER')
  assert.equal(output.records[0].actionId, 'first'); assert.equal(output.after.filter(row => row.text === 'second').length, 0)
  assert.ok(input.rules[0].actions[0].target); input.rules[0].actions[0].target.anchor = 'missing'
  assert.throws(() => planDisplayV2(input), /display-anchor-unavailable/)
})

test('display filtering preserves opaque descendant denial and original output byte boundary', () => {
  const input = options(); input.rules = [rule([action('hide', [], { kind: 'filter', template: undefined })])]
  input.blocks.push(block('nested', '0.1', { signed: true }))
  assert.throws(() => planDisplayV2(input), /display-opaque-filter-denied/)
  const plain = options(), planned = planDisplayV2(plain), { changed, ...body } = planned
  assert.equal(changed, true)
  const exact = Buffer.byteLength(JSON.stringify(body), 'utf8')
  assert.deepEqual(planDisplayV2({ ...plain, maxBytes: exact }), planned)
  assert.throws(() => planDisplayV2({ ...plain, maxBytes: exact - 1 }), /display-result-budget-exceeded/)
})
