import { planDisplay as planDisplayV2, createBlockPatchPlan, applyBlockPatchesV2, normalizeRuleV2, type RuleEvent, type DisplayPlanInput, type BlockPatch } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import assert from 'node:assert/strict'

const block = (id: string, text = '0123456789🙂ABCDE') => ({ id, view: 'display', path: '0', type: 'text', role: 'assistant', text, raw: { type: 'text', text } })
const patch = (blockId: string, actionId: string, range: readonly number[], priority = 0, text = actionId): BlockPatch => ({ blockId, actionId, range, priority, text })

test('affected-block staging matches every original decision and final engine result across priority and overlap changes', () => {
  const baseline = Array.from({ length: 20 }, (_, index) => block(`b:${index}`)), committed: BlockPatch[] = []
  const original = structuredClone(baseline), staged = createBlockPatchPlan(baseline)
  for (let index = 0; index < 300; index++) {
    const id = `b:${index % 20}`, actionId = `same:${index % 31}`, start = index % 13
    const candidates = [patch(id, actionId, [start, start + (index % 4)], index % 9 - 4, `replacement:${index}`)]
    if (index % 7 === 0) candidates.push(patch(id, actionId, [0, 1], index % 9 - 4, `extra:${index}`))
    const expected = applyBlockPatchesV2(baseline, [...committed, ...candidates]).results.some((result: { actionId: string; status: string }) => result.actionId === actionId && result.status === 'planned')
    assert.equal(staged.accept(candidates), expected, `candidate ${index}`)
    if (expected) committed.push(...candidates)
    assert.deepEqual(staged.finish(), applyBlockPatchesV2(baseline, committed), `committed prefix ${index}`)
  }
  assert.deepEqual(baseline, original, 'neither staging nor final materialization edits the committed baseline')
})

test('incremental conflict cascades match every original prefix with dense same-block ranges', () => {
  let random = 934732
  const next = (max: number) => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % max }
  for (let trial = 0; trial < 12; trial++) {
    const baseline = [block('a'), block('b'), block('a', 'SHORT')], committed: BlockPatch[] = []
    const staged = createBlockPatchPlan(baseline)
    for (let index = 0; index < 120; index++) {
      const id = next(3) ? 'a' : 'b', actionId = `shared:${next(12)}`, priority = next(11) - 5
      const candidates = Array.from({ length: 1 + next(3) }, () => { const start = next(17); return patch(id, actionId, [start, start + next(18 - start)], priority, `${index}🙂`) })
      const expected = applyBlockPatchesV2(baseline, [...committed, ...candidates]).results.some(result => result.actionId === actionId && result.status === 'planned')
      assert.equal(staged.accept(candidates), expected, `trial ${trial}, candidate ${index}`)
      if (expected) committed.push(...candidates)
      assert.deepEqual(staged.finish(), applyBlockPatchesV2(baseline, committed), `trial ${trial}, prefix ${index}`)
    }
  }
})

test('staging retains global planned action-id membership and duplicate block materialization', () => {
  const baseline = [block('a'), block('b'), block('a', 'DUPLICATE TEXT LONG ENOUGH')]
  const staged = createBlockPatchPlan(baseline), committed: BlockPatch[] = []
  const batches = [[patch('a', 'shared', [0, 4], 1)], [patch('b', 'winner', [0, 4], 10)],
    [patch('b', 'shared', [0, 4], 0)], [patch('a', 'replacement', [0, 4], 20)], [patch('b', 'shared', [0, 4], -1)],
    [patch('a', 'zero', [4, 4], 3)], [patch('a', 'zero', [4, 4], 3)]]
  for (const candidates of batches) {
    const expected = applyBlockPatchesV2(baseline, [...committed, ...candidates]).results.some((result: { actionId: string; status: string }) => result.actionId === candidates[0].actionId && result.status === 'planned')
    assert.equal(staged.accept(candidates), expected)
    if (expected) committed.push(...candidates)
    assert.deepEqual(staged.finish(), applyBlockPatchesV2(baseline, committed))
  }
  assert.equal(committed.filter(item => item.actionId === 'shared').length, 2, 'a skipped candidate is committed when the same id remains planned elsewhere')
  assert.notEqual(staged.finish().blocks[0].text, baseline[0].text)
  assert.notEqual(staged.finish().blocks[2].text, baseline[2].text)
})

test('staging validates only new ranges and materializes each affected row once', () => {
  const baseline = Array.from({ length: 1000 }, (_, index) => block(`b:${index}`))
  let work = 0
  const staged = createBlockPatchPlan(baseline, amount => { work += amount })
  for (let index = 0; index < 1000; index++) assert.equal(staged.accept([patch(`b:${index}`, `a:${index}`, [0, 1])]), true)
  assert.equal(work, 1000, 'candidate admission never materializes full text or revalidates committed patches')
  const result = staged.finish(); assert.equal(work, 2000)
  assert.equal(result.results.length, 1000); assert.equal(result.blocks.length, 1000)
})

test('one block admits thousands of ranges without copying or replaying its old patch prefix', () => {
  const baseline = [block('one', 'x'.repeat(16000))], patches: BlockPatch[] = []
  let work = 0, textReads = 0, rawReads = 0
  const counted = { ...baseline[0], get text() { textReads++; return baseline[0].text }, get raw() { rawReads++; return baseline[0].raw } }
  const staged = createBlockPatchPlan([counted], amount => { work += amount })
  for (let index = 0; index < 4000; index++) {
    const candidate = patch('one', `a:${index.toString().padStart(4, '0')}`, [index * 4, index * 4 + 1], 0, '🙂')
    assert.equal(staged.accept([candidate]), true); patches.push(candidate)
  }
  assert.equal(rawReads, 0, 'no intermediate text transformation before finish')
  assert.ok(textReads < 13000, `only new-range validation reads text, got ${textReads}`)
  assert.ok(work < 200000, `interval visits must not grow as the full cumulative prefix, got ${work}`)
  const actual = staged.finish(); assert.deepEqual(actual, applyBlockPatchesV2(baseline, patches))
  assert.ok(rawReads <= 2, 'one block output, not 4000 intermediate copies')
})

test('rejected wide patches find one blocker rather than scan all accepted ranges', () => {
  const baseline = [block('wide', 'x'.repeat(20000))]
  let work = 0
  const staged = createBlockPatchPlan(baseline, amount => { work += amount })
  for (let index = 0; index < 2000; index++) assert.equal(staged.accept([patch('wide', `a:${index}`, [index * 4, index * 4 + 2], 10)]), true)
  const before = work
  for (let index = 0; index < 2000; index++) assert.equal(staged.accept([patch('wide', `z:${index}`, [0, 20000], -1)]), false)
  assert.ok(work - before < 100000, `rejections inspected ${work - before} nodes, not 4 million old ranges`)
  assert.equal(staged.finish().results.length, 2000)
})

test('higher-priority displacement reconsiders previously blocked ranges and retains zero-width tie order', () => {
  const baseline = [block('one'), block('one', 'tiny')], committed: BlockPatch[] = []
  const staged = createBlockPatchPlan(baseline)
  const batches = [[patch('one', 'a', [2, 6], 1)], [patch('one', 'shared', [0, 4], 0), patch('one', 'shared', [8, 9], 0)],
    [patch('one', 'high', [4, 7], 3)], [patch('one', 'zero-first', [8, 8], 9)], [patch('one', 'next', [8, 8], 8)],
    [patch('one', 'widest', [0, 15], 10)]]
  for (const candidates of batches) {
    const expected = applyBlockPatchesV2(baseline, [...committed, ...candidates]).results.some(result => result.actionId === candidates[0].actionId && result.status === 'planned')
    assert.equal(staged.accept(candidates), expected); if (expected) committed.push(...candidates)
    assert.deepEqual(staged.finish(), applyBlockPatchesV2(baseline, committed))
  }
  const duplicate = block('same'), duplicates = createBlockPatchPlan([duplicate, duplicate])
  duplicates.accept([patch('same', 'once', [0, 1])]); const output = duplicates.finish()
  assert.notEqual(output.blocks[0], output.blocks[1]); assert.deepEqual(output.blocks[0], output.blocks[1])
})

test('UTF16 and same-start zero-width patches preserve sequential slice semantics', () => {
  const baseline = [block('unicode', 'A🙂BCDEF'), block('unicode', '短')]
  for (const edits of [
    [patch('unicode', 'first', [1, 1], 3, 'XYZ'), patch('unicode', 'second', [1, 4], 2, '')],
    [patch('unicode', 'first', [1, 4], 3, 'X'), patch('unicode', 'second', [1, 1], 2, '🙂')],
    [patch('unicode', 'split-surrogate', [2, 3], 3, '半'), patch('unicode', 'empty', [8, 8], 2, '')],
    [patch('unicode', 'same', [0, 0], 1, 'X'), patch('unicode', 'same', [0, 0], 1, 'Y')],
  ]) {
    const staged = createBlockPatchPlan(baseline)
    for (const edit of edits) assert.equal(staged.accept([edit]), true)
    assert.deepEqual(staged.finish(), applyBlockPatchesV2(baseline, edits))
  }
})

test('staging borrows an existing exact identity directory instead of rebuilding baseline ids', () => {
  let reads = 0, lookups = 0
  const baseline = Array.from({ length: 1000 }, (_, index) => ({ ...block(`b:${index}`), get id() { reads++; return `b:${index}` } }))
  const groups = new Map(baseline.map(row => [row.id, [row]])), before = reads
  const staged = createBlockPatchPlan(baseline, () => {}, id => { lookups++; return groups.get(id) ?? [] })
  assert.equal(reads, before, 'the same immutable cut is not scanned again at construction')
  assert.equal(staged.accept([patch('b:999', 'last', [0, 1])]), true); assert.equal(lookups, 1)
  assert.ok(reads - before < 10, 'one candidate does not inspect ids in the unrelated 999 baseline rows')
})

test('staging preserves authoritative errors and failed speculative batches never publish changes', () => {
  const baseline = [block('good'), { ...block('signed'), signed: true }, { ...block('segmented'), segments: [] }]
  const staged = createBlockPatchPlan(baseline)
  assert.equal(staged.accept([patch('good', 'ok', [0, 1])]), true); const before = staged.finish()
  for (const candidates of [[patch('missing', 'late', [0, 1])], [patch('signed', 'late', [0, 1])],
    [patch('segmented', 'late', [0, 1])], [patch('good', 'late', [-1, 1])], [patch('good', 'late', [2, 1])], [patch('good', 'late', [0, 100])]]) {
    let message = ''
    try { applyBlockPatchesV2(baseline, [patch('good', 'ok', [0, 1]), ...candidates]) } catch (error) { if (!(error instanceof Error)) throw error; message = error.message }
    assert.ok(message); assert.throws(() => staged.accept(candidates), (error: Error) => error.message === message)
    assert.deepEqual(staged.finish(), before)
  }
  const badText = patch('good', 'bad-text', [0, 1]); Reflect.set(badText, 'text', undefined)
  const mixed = [patch('good', 'mixed', [0, 1], 1), patch('good', 'mixed', [-1, 1], 0)]
  assert.throws(() => staged.accept([badText]), /replacement must be text/)
  assert.throws(() => staged.accept(mixed), /invalid patch range/)
  assert.deepEqual(staged.finish(), before, 'a later invalid range cannot commit the earlier valid member')
  assert.throws(() => staged.accept([]), /display-patch-empty-candidate/)
  assert.throws(() => staged.accept([patch('good', 'a', [0, 1]), patch('good', 'b', [2, 3])]), /display-patch-mixed-candidate/)
})

test('display planner retains overlap outcomes dependencies and precise byte limit after grouped patches', () => {
  const b = block('b'), actions = [{ id: 'replace', enabledDefault: true, dependsOn: [], stage: 'display.render', kind: 'replace', template: 'X' },
    { id: 'caption', enabledDefault: true, dependsOn: ['replace'], stage: 'display.render', kind: 'inject', template: 'CAPTION', target: { view: 'display', anchor: 'end' } }]
  const input: DisplayPlanInput<typeof b> = { blocks: [b], rules: [normalizeRuleV2({ schemaVersion: 2, sourceId: 's', id: 'r', revision: 1, on: ['display.render'],
    select: { view: 'display', roles: ['assistant'], blockTypes: ['text'] }, match: { kind: 'always' }, actions })],
    events: [0, 1].map((index): RuleEvent => ({ schemaVersion: 2, sourceId: 's', ruleId: 'r', ruleRevision: 1, stage: 'display.render', view: 'display', coordinate: 'utf16',
      sourceSeqs: [], facts: {}, occurrenceId: `e:${index}`, blockId: 'b', block: b, ranges: [[0, 1]], captures: {} })),
    templates: { render: (text: string) => text }, snapshot: {}, decision: () => ({ enabled: true }), maxInjectedChars: 65536, maxBytes: 100000 }
  const result = planDisplayV2(input)
  assert.deepEqual(result.records.map(record => record.status), ['planned', 'planned', 'skipped', 'skipped'])
  assert.equal(result.after[0].text, 'X123456789🙂ABCDE'); assert.equal(result.after[1].text, 'CAPTION')
  const { changed, ...body } = result; assert.equal(changed, true)
  const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8'); assert.deepEqual(planDisplayV2({ ...input, maxBytes: bytes }), result)
  assert.throws(() => planDisplayV2({ ...input, maxBytes: bytes - 1 }), /display-result-budget-exceeded/)
  // An external JavaScript helper can violate its declared result at runtime.
  assert.throws(() => planDisplayV2({ ...input, templates: { render: () => Reflect.get({}, 'missing') } }), /replacement must be text/)
})
