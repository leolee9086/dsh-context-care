// 复现：往规则来源里塞一条与已有规则同 id 的规则，请求就发不出去。
//
// 背景（2026-09-24）：我用一个动态 Cordis 插件把规则 push 进索引插件的
// memoryNoticeRules 数组，想造一次真实改写来验收卡片。插件一生效，
// 模型请求全部发不出去，界面显示 Connection error 并重试到人介入。
//
// 机制：
//   · 运行中的宿主 src/index.js（eee7287 之前的版本）在 rules() 里追加了一条
//     临时探针规则，id 就是 probe-request-rewrite；
//   · 我那条规则用了同一个 id；
//   · 规则引擎 currentRules() 对每个来源产出的规则跑 normalizeRules()，
//     同一个数组里 id 重复直接抛 "duplicate rule id"（rules.js 头注释写明：
//     写坏的规则必须立刻抛错，静默跳过等于让用户以为它在生效）；
//   · 抛错发生在 engine.run() 里 → 改写器抛错 → fetch-router 拒绝发送。
//     所以请求根本出不去，也不会有改写记录。
//
// 判据是**服务端收到的字节数**，不是异常类型：请求发不出去，服务端就一个字节都收不到。
// 用真实 Cordis、真实 fetch-router 入口、真实改写器、真实规则引擎、回环 HTTP 服务。
// 不碰运行中的 DSH 进程。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../dsh-fetch-router/lib/index.js'
import { createRequestRewriter } from '../src/request-rewrite.js'

const received = []
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  received.push(Buffer.concat(chunks).toString('utf8'))
  res.end('ok')
})

/** 宿主里那条临时探针规则（eee7287 之前的 src/index.js 追加的就是它）。 */
const hostProbeRule = {
  id: 'probe-request-rewrite',
  order: 999,
  placement: ['request'],
  when: { findRegex: '/\\[\\[REWRITE-PROBE\\]\\]/g', replaceString: '[[REWRITTEN]]' },
  action: { kind: 'transform' },
  budget: { maxCacheLoss: 1 },
}

/** 我那条动态插件塞进去的规则：除了 findRegex/replaceString，和宿主那条一模一样。 */
const myRule = {
  id: 'probe-request-rewrite', // ← 撞的就是这一行
  order: 999,
  placement: ['request'],
  when: { findRegex: '/ZZMARKERZZ/g', replaceString: 'QQREPLACEDQQ' },
  action: { kind: 'transform' },
  budget: { maxCacheLoss: 1 },
}

/** 索引插件的 memoryNoticeRules：一个纯数据数组，别的插件可以往里 push。 */
const sharedRules = []

const ctx = new Context()
const originalFetch = globalThis.fetch
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/chat/completions`
const trigger = '[[' + 'REWRITE-PROBE' + ']]'
const body = JSON.stringify({ messages: [{ role: 'user', content: trigger }] })
const send = () => fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(5000) })

try {
  apply(ctx, { routes: [], panel: { enabled: false } })
  const unregister = ctx.get('requestRewrite').register('context-care', createRequestRewriter({
    // 宿主的取规则函数：共享数组 + 自己追加的那条探针 —— 与运行中的进程一致。
    rules: () => [...sharedRules, hostProbeRule],
    onRecord: () => {},
  }))

  // 一、还没有我那条规则时：请求正常发出，并被改写过。
  assert.equal((await send()).status, 200)
  assert.equal(received.length, 1)
  assert.equal(JSON.parse(received.at(-1)).messages[0].content, '[[REWRITTEN]]')
  console.log('一、宿主原样：请求发出，服务端收到改写后的文本')

  // 二、我做的事：往共享数组里 push 一条同 id 的规则。
  sharedRules.push(myRule)
  await assert.rejects(send, /duplicate rule id "probe-request-rewrite"/)
  assert.equal(received.length, 1) // ← 服务端一个字节都没多收到：请求发不出去
  console.log('二、同 id：请求根本发不出去（服务端收到的字节数没变）')

  // 三、只把 id 换掉，其余一字不动：请求又正常发出。
  //     用来证明原因是 id 撞车，不是「push 这个动作」本身。
  sharedRules[0] = { ...myRule, id: 'probe-card-check' }
  assert.equal((await send()).status, 200)
  assert.equal(received.length, 2)
  console.log('三、只换个 id：请求正常发出 —— 撞 id 才是原因')

  // 四、另一种宿主形状：探针规则本身就在共享数组里（不是 rules() 追加的）。
  //     同一来源内部 id 重复，同样抛错，同样发不出去。
  sharedRules.length = 0
  sharedRules.push(hostProbeRule, { ...myRule, id: 'probe-request-rewrite' })
  unregister()
  const off = ctx.get('requestRewrite').register('context-care', createRequestRewriter({
    rules: () => sharedRules,
    onRecord: () => {},
  }))
  await assert.rejects(send, /duplicate rule id "probe-request-rewrite"/)
  assert.equal(received.length, 2)
  console.log('四、探针本来就在共享数组里：同样发不出去')
  off()

  console.log('复现结论：同 id 的规则出现在同一个来源产出的数组里，请求发不出去；')
  console.log('          这与运行中「出错窗口内没有任何改写记录、也没有任何服务端响应」一致。')
} finally {
  await ctx.fiber.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  assert.equal(globalThis.fetch, originalFetch)
}
