import { CLAIM_DOMAIN, isDefiniteStorageFailure, createBoundedMatcher } from '@leolee9086/dsh-rule-engine'
import test from 'node:test'
import { eventRule } from './event-rule.js'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { createReminderRuntime } from './reminder-runtime-fixture.ts'

import { openRealReminderStorage, obstructRecord } from './fixtures/reminder-persistence-real.ts'

// This replaces the legacy integration case which threw synthetic session/claim
// errors before calling storage. Both failures below are actual native renames.
test('real shared quota: failed session save compensates; failed claim release can retry without releasing consumed quota',
  { timeout: 30000 }, async t => {
    const store = await openRealReminderStorage()
    const matcher = createBoundedMatcher({ timeoutMs: 2000, maxIdle: 1 })
    const runtime = createReminderRuntime({
      config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000, storageTimeoutMs: 2000 },
      execute: (input, signal, timing) => matcher.detect(input, signal, timing), dispatches: true,
      save: (id, state) => store.sessions.put(id, state),
      updateClaims: change => store.claims.update('global', change),
    })
    t.after(async () => {
      await runtime.close()
      await matcher.close()
      await store.close()
      await rm(store.root, { recursive: true })
    })
    const claimPath = join(store.root, CLAIM_DOMAIN.name, 'claims', 'global.json')
    const readClaimsDisk = async () => {
      const envelope: unknown = JSON.parse(await readFile(claimPath, 'utf8'))
      return z.object({ version: z.literal(1), record: CLAIM_DOMAIN.tables.claims.valueSchema }).parse(envelope).record
    }
    runtime.registerSource({ sourceId: 'fault-quota', plugin: 'test', revision: 1, rules: [eventRule('tool.succeeded', { id: 'one', event: { tool: 'read' } }, { template: 'One shared notice', delivery: { model: { once: 'surface', shared: { reset: 'lifetime', lifetime: 'one', limit: 1 } } } })] })
    await matcher.warmup()
    for (const sessionId of ['a', 'b']) await runtime.submit({ type: 'tool.succeeded', sessionId,
      callId: sessionId, rootCallId: sessionId, name: 'read', arguments: {} })
    const beforeSession = await store.readDisk('a')
    const restoreSession = await obstructRecord(store.recordPath('a'))
    try { await assert.rejects(runtime.collect({ sessionId: 'a', visible: [] }), isDefiniteStorageFailure) }
    finally { await restoreSession() }
    assert.deepEqual(await store.readDisk('a'), beforeSession)
    assert.deepEqual(await readClaimsDisk(), { buckets: [] }, 'failed session reservation compensates its actual durable claim')
    const messages = await runtime.collect({ sessionId: 'a', visible: [] })
    assert.equal(messages.length, 1)
    assert.deepEqual(await runtime.collect({ sessionId: 'b', visible: [] }), [])
    const reservedClaims = await readClaimsDisk()
    const restoreClaim = await obstructRecord(claimPath)
    try { await assert.rejects(runtime.rollback('a', messages), isDefiniteStorageFailure) }
    finally { await restoreClaim() }
    const rolledBack = await store.readDisk('a')
    assert.equal(rolledBack.candidates[0]?.status, 'pending')
    assert.equal(rolledBack.candidates[0]?.messageId, messages[0]?.id, 'failed release retains the identity needed for retry')
    assert.deepEqual(await readClaimsDisk(), reservedClaims, 'failed native claim release leaves the actual quota reserved')
    assert.deepEqual(await runtime.filterMessages('a', [], messages), [])
    await runtime.rollback('a', messages)
    const second = await runtime.collect({ sessionId: 'b', visible: [] })
    assert.equal(second.length, 1, 'successful release allows the other session to reserve the quota')
    await runtime.collect({ sessionId: 'b', visible: second })
    await runtime.rollback('b', second)
    const consumed = await readClaimsDisk()
    assert.equal(consumed.buckets[0]?.claims[0]?.status, 'consumed')
    assert.deepEqual(await runtime.collect({ sessionId: 'a', visible: [] }), [], 'rollback cannot reclaim already consumed quota')
    t.diagnostic(JSON.stringify({ failedRelease: rolledBack.candidates[0]?.status,
      recoveredMessages: second.length, durableClaims: consumed }))
  })
