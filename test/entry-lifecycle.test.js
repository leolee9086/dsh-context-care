import test from 'node:test'
import assert from 'node:assert/strict'
import { entryPolicy, deliveredEntry, deactivatedEntry, entryTurn } from '../src/entry-lifecycle.js'
import { validateDocument } from '../src/workbench-store.js'
import { createTemplates } from '../src/templates.js'

const entry = extra => ({ id: 'entry', revision: 1, title: 'Entry', enabledDefault: true, template: 'TEXT',
  activation: { kind: 'constant' }, select: { view: 'model', roles: ['user'], blockTypes: ['text'] }, target: { view: 'model' },
  lifetime: 'request', stickyTurns: 0, cooldownMs: 0, activationCooldownMs: 0, ...extra })
const at = (turn, matches = false, now = 1000) => ({ turnId: `session:turn:${turn}`, turn, matches, now })
const activate = (definition, turn = 1) => deliveredEntry(definition, undefined, entryPolicy(definition, undefined, at(turn, true)), 'literal {{not-a-template}}', at(turn, true))

test('held slices materialize on each request within a turn, a fixed number of real turns, or the complete session', () => {
  for (const lifetime of ['turn', 'turns', 'session']) {
    const definition = entry({ lifetime, ...(lifetime === 'turns' ? { lifetimeTurns: 2 } : {}), cooldownMs: 99999 })
    const previous = activate(definition)
    assert.equal(entryPolicy(definition, previous, at(1)).text, 'literal {{not-a-template}}')
    assert.equal(entryPolicy(definition, previous, at(1)).reason, undefined)
    assert.equal(entryPolicy(definition, previous, at(2)).reuse, lifetime !== 'turn')
    assert.equal(entryPolicy(definition, previous, at(3)).reuse, lifetime === 'session')
    assert.equal(previous.materialization.turn, 1)
  }
  assert.equal(entryTurn({ snapshotEvents: () => [] }), 0)
  assert.equal(entryTurn({ snapshotEvents: () => [{ type: 'turn/start', seq: 999, data: { turn: 42 } }] }), 42)
  assert.throws(() => entryTurn({ snapshotEvents: () => [{ type: 'turn/start', data: {} }] }), /entry-turn-unavailable/)
})

test('until-inactive slices release only at deactivation and respect an independent reactivation cooldown', () => {
  const definition = entry({ lifetime: 'until-inactive', activationCooldownMs: 100 })
  const previous = activate(definition)
  assert.equal(entryPolicy(definition, previous, at(2, true)).reuse, true)
  const policy = entryPolicy(definition, previous, at(2, false))
  assert.equal(policy.inactive, true)
  const inactive = deactivatedEntry(previous, 1100)
  assert.equal(inactive.materialization, undefined)
  assert.equal(previous.materialization.text, 'literal {{not-a-template}}')
  assert.equal(entryPolicy(definition, inactive, at(3, true, 1199)).reason, 'entry-inactive-cooldown')
  assert.equal(entryPolicy(definition, inactive, at(3, true, 1200)).reason, undefined)
})

test('sticky requests retain the last strictly matched turn without extending it on held-only delivery', () => {
  const definition = entry({ stickyTurns: 2, cooldownMs: 100 })
  const previous = activate(definition)
  const policy = entryPolicy(definition, previous, at(2))
  const repeated = deliveredEntry(definition, previous, policy, policy.text, at(2, false, 1050))
  assert.equal(repeated.materialization.stickyUntilTurn, 3)
  assert.equal(repeated.lastActivationAt, 1000)
  assert.equal(entryPolicy(definition, repeated, at(3)).reuse, true)
  assert.equal(entryPolicy(definition, repeated, at(4)).reuse, false)
  assert.equal(entryPolicy(entry({ cooldownMs: 100 }), activate(entry()), at(1, true, 1099)).reason, 'entry-activation-interval')
  assert.equal(entryPolicy(entry({ cooldownMs: 100 }), activate(entry()), at(1, true, 1100)).reason, undefined)
})

test('entry declarations reject missing turn durations and persistent display lifetimes at the document parser', () => {
  const document = definition => ({ schemaVersion: 2, id: 'doc', revision: 1, title: 'Doc', entries: [definition] })
  const templates = createTemplates()
  assert.throws(() => validateDocument(document(entry({ lifetime: 'turns' })), templates), /lifetimeTurns/)
  assert.throws(() => validateDocument(document(entry({ lifetimeTurns: 2 })), templates), /lifetimeTurns/)
  assert.throws(() => validateDocument(document(entry({ target: { view: 'display' }, lifetime: 'session' })), templates), /display entries require request/)
  assert.equal(validateDocument(document(entry({ lifetime: 'turns', lifetimeTurns: 2 })), templates).entries[0].lifetimeTurns, 2)
  assert.throws(() => entryPolicy(entry(), { materialization: { text: 'broken' } }, at(1)))
})
