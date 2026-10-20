import test from 'node:test'
import assert from 'node:assert/strict'
import { createReminderRuntime } from '../lib/reminder-runtime/runtime.js'

/**
 * 复现：持久化超时之后，前一次写入还在飞，后一次写入已经落盘；
 * 前一次迟到落地时用旧快照覆盖了新快照。
 *
 * 更糟的是失败的痕迹被清掉了——迟到的那次 save 成功会让 runtime 执行
 * `failures.delete(id)`，于是 `storageError` 报"正常"，而盘上是退回的旧状态。
 *
 * 走的是真实业务路径：registerSource → submit → 串行 update → persist。
 * 只有 save 本身由测试提供（它是 RuntimeOptions 的注入点），
 * 因为"慢盘"这件事只能在端口上模拟。
 */
test('存储写入超时后，迟到的落盘把状态写回退，且不留任何错误痕迹', async t => {
  const disk = new Map<string, unknown>()
  const landed: string[] = []
  let saves = 0
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })

  const runtime = createReminderRuntime({
    // storageTimeoutMs 很小，让第一次写入必定超时；第一次 save 被闸门挂住不返回。
    config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000, storageTimeoutMs: 20 },
    execute: async () => ({ ok: true }),
    save: async (id, state) => {
      saves++
      const index = saves
      if (index === 1) await firstGate
      disk.set(id, structuredClone(state))
      landed.push('save' + index)
    },
  })
  t.after(() => runtime.close())

  // 必须有一条真实规则，admit 才会写 seen 并进入评估。
  runtime.registerSource({ sourceId: 'storage-race', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'NOTICE',
    when: { tool: 'probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] })

  const event = (callId: string) => ({ type: 'tool.succeeded', sessionId: 's', callId, rootCallId: callId,
    name: 'probe', arguments: {} })
  const written = () => (disk.get('s') as { seen: string[] } | undefined)?.seen

  // 第一次提交：第一次写入被闸门挂住；persist 在 20ms 后超时返回，
  // 所以提交本身照常完成（这正是"超时不抛"的设计后果）。
  await runtime.submit(event('c1'))
  assert.ok(saves >= 1, '第一次写入已经开始且尚未返回')

  // 第二次提交：内存状态里已经有 c1。这一次写入排在卡住的那次之后，不会抢着落盘。
  await runtime.submit(event('c2'))
  // 行为断言，而不是计数断言：排在前面的写入没落地之前，任何写入都不许落盘。
  assert.deepEqual(landed, [], '后面的写入不许越过卡住的那一次先落盘')
  assert.equal(written(), undefined, '盘上还没有任何快照')
  // 写入未确认的这段时间，必须能从运行时看出来存储不可信。
  assert.equal(runtime.snapshot('s').storageError, true, '未确认期间必须可见')

  // 放行卡住的那次写入。
  releaseFirst()
  // 等队列跑完：晚到的那次先落盘，后面的再落盘，顺序就是 update 的顺序。
  const until = Date.now() + 2000
  while (!(written() ?? []).includes('c2') && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5))

  assert.deepEqual(landed.slice(0, 2), ['save1', 'save2'], '落盘顺序必须等于发起顺序')
  assert.deepEqual(written(), ['c1', 'c2'], '最终盘上必须是最新快照，不能被旧快照覆盖')
  // 写成功之后存储确实恢复正常：此时盘上就是最新状态，报"有问题"反而是假话。
  assert.equal(runtime.snapshot('s').storageError, false, '确认落盘后恢复正常')
})

/**
 * 写回策略的第二半：合并。
 *
 * 状态是整份覆盖的，所以慢盘时只需要把「最新那一份」写出去，
 * 中间态写不写不影响最终结果——把它们排队写一遍只会把队列堆成 N 份，
 * 而且每份都要等一次慢盘。
 *
 * 这里在第一次写入卡住期间制造大量状态变更，验证真实落盘次数被合并到常数级。
 */
test('慢盘期间的大量状态变更被合并成常数次落盘', async t => {
  const disk = new Map<string, unknown>()
  let saves = 0
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })

  const runtime = createReminderRuntime({
    config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000, storageTimeoutMs: 5 },
    execute: async () => ({ ok: true }),
    save: async (id, state) => {
      saves++
      if (saves === 1) await firstGate
      disk.set(id, structuredClone(state))
    },
  })
  t.after(() => runtime.close())

  runtime.registerSource({ sourceId: 'coalesce', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'N',
    when: { tool: 'probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] })

  const event = (n: number) => ({ type: 'tool.succeeded', sessionId: 's', callId: 'c' + n, rootCallId: 'c' + n,
    name: 'probe', arguments: {} })
  const written = () => (disk.get('s') as { seen: string[] } | undefined)?.seen

  // 第一次写入被闸门卡住；后面 20 次提交各自产生状态变更，全部只能落在待写位上。
  await runtime.submit(event(1))
  for (let n = 2; n <= 21; n++) await runtime.submit(event(n))

  assert.equal(saves, 1, '卡住期间只有那一次写入真正发起，后面的被合并成「一份待写」')

  releaseFirst()
  const until = Date.now() + 3000
  while ((written() ?? []).length < 21 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5))

  assert.ok(saves <= 3, '21 次提交只该产生常数次落盘，实际 ' + saves + ' 次')
  assert.equal((written() ?? []).length, 21, '合并之后盘上仍然是最新的完整状态')
})

/**
 * 写回把落盘往后推了，关闭就必须替它兜底：那些快照就是内存里的最终状态，
 * close 返回时它们必须已经在盘上，不能留在内存里跟着实例一起丢。
 */
test('关闭时把待写快照交出去，而不是留在内存里丢掉', async () => {
  const disk = new Map<string, unknown>()
  let attempts = 0
  const runtime = createReminderRuntime({
    config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000, storageTimeoutMs: 200 },
    execute: async () => ({ ok: true }),
    save: async (id, state) => {
      attempts++
      // 第一次写盘失败：快照被放回待写位，写者也退出了——此后没有新的状态变更，
      // 这份快照就只等着关闭时被交出去。
      if (attempts === 1) throw new Error('disk-down')
      disk.set(id, structuredClone(state))
    },
  })
  runtime.registerSource({ sourceId: 'close-flush', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'N',
    when: { tool: 'probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] })

  // 写入失败必须传回调用方：否则回滚和预留补偿都不会发生。
  await assert.rejects(runtime.submit({ type: 'tool.succeeded', sessionId: 's', callId: 'c1', rootCallId: 'c1',
    name: 'probe', arguments: {} }), /disk-down/)
  assert.equal(disk.has('s'), false, '写失败了，盘上当然没有')

  await runtime.close()
  assert.ok(disk.has('s'), 'close 返回时待写快照必须已经落盘')
  assert.deepEqual((disk.get('s') as { seen: string[] }).seen, ['c1'])
})

/**
 * close 的等待窗口必须比单次写入宽。
 *
 * 写者是按顺序排空的：一次慢写没完，后面的快照就都在等它。
 * 如果 close 只等一个 storageTimeoutMs，那么只要盘比这个窗口稍慢，
 * close 就会在最后一份快照落地前撒手，而那份快照正是内存里的最终状态。
 */
test('关闭给的窗口要够写者排空，不能半途撒手', async () => {
  const disk = new Map<string, unknown>()
  let attempts = 0
  const runtime = createReminderRuntime({
    config: { ruleTimeoutMs: 2000, roundTimeoutMs: 5000, storageTimeoutMs: 200 },
    execute: async () => ({ ok: true }),
    save: async (id, state) => {
      attempts++
      // 第一次立刻失败：快照被放回待写位、写者退出，此后没有别的落盘机会。
      if (attempts === 1) throw new Error('disk-down')
      // 第二次需要 300ms：比一个窗口慢，只有两个窗口才装得下。
      await new Promise(resolve => setTimeout(resolve, 300))
      disk.set(id, structuredClone(state))
    },
  })
  runtime.registerSource({ sourceId: 'close-window', plugin: 'test', revision: 1, rules: [{
    format: 'reminder/v4', id: 'notice', on: 'tool.succeeded', text: 'N',
    when: { tool: 'probe' }, effect: { kind: 'remind', deliver: { model: { once: 'surface' } } } }] })

  await assert.rejects(runtime.submit({ type: 'tool.succeeded', sessionId: 's', callId: 'c1', rootCallId: 'c1',
    name: 'probe', arguments: {} }), /disk-down/)
  assert.equal(disk.has('s'), false, '写失败了，盘上当然没有')

  await runtime.close()
  // close 是这份快照唯一的落盘机会：窗口只给一个 storageTimeoutMs 就会撒手。
  assert.equal(attempts, 2, 'close 必须真的重试一次，实际尝试 ' + attempts + ' 次')
  assert.ok(disk.has('s'), 'close 返回时这份快照必须已经落盘')
  assert.deepEqual((disk.get('s') as { seen: string[] }).seen, ['c1'])
})
