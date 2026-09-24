// 消息源归属：V4 拒绝退役的 {kind:'plugin'} 包装，插件必须发出生产者自己的 kind。
// 这条测试锁住两件事：发出的是 V4 允许的形状；读取时新旧两种写法都认。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHECKPOINT_KIND, isCheckpointSource, producedBy, producedUnder, producerKind, producerOf,
} from '../src/producer-source.js'

test('发出的 kind 不是退役的 plugin 包装', () => {
  const source = { kind: producerKind('dsh-context-care:state'), form: 'notice', summary: 'Context state' }
  assert.notEqual(source.kind, 'plugin')
  assert.equal(source.kind, 'plugin:dsh-context-care:state')
  assert.equal(producedBy(source, 'dsh-context-care:state'), true)
})

test('认得出未迁移的 V3 包装（迁移前的事件仍在 surface 上）', () => {
  const legacy = { kind: 'plugin', plugin: 'dsh-context-care:state', form: 'notice' }
  assert.equal(producedBy(legacy, 'dsh-context-care:state'), true)
  assert.equal(producedUnder(legacy, 'dsh-context-care:'), true)
  assert.equal(producerOf(legacy), 'dsh-context-care:state')
})

test('未知生产者家族按前缀判定', () => {
  assert.equal(producedUnder({ kind: producerKind('dsh-context-care:rules:r1') }, 'dsh-context-care:'), true)
  assert.equal(producedUnder({ kind: producerKind('dsh-context-care:state') }, 'other:'), false)
  assert.equal(producedUnder({ kind: 'model-selection' }, 'dsh-context-care:'), false)
  assert.equal(producerOf({ kind: 'model-selection' }), undefined)
})

test('交接标记在新旧两种写法下都认，且不误认自己的状态消息', () => {
  assert.equal(CHECKPOINT_KIND, 'compact-checkpoint')
  assert.equal(isCheckpointSource({ kind: CHECKPOINT_KIND, compactionId: 'c1' }), true)
  assert.equal(isCheckpointSource({ kind: 'plugin', plugin: 'compact', compactionId: 'c1' }), true)
  assert.equal(isCheckpointSource({ kind: producerKind('dsh-context-care:state') }), false)
  assert.equal(isCheckpointSource(undefined), false)
})
