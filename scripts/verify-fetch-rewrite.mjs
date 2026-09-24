// 本地联调：使用真实 Cordis、fetch-router 插件入口、context-care 改写器和 HTTP 服务。
// 不替换 fetch、不替换插件的 record 回调；服务端按真实收到的字节判断。
// 无需凭据，不连接任何模型服务，不改当前 DSH 进程。
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
const ctx = new Context()
const originalFetch = globalThis.fetch
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/chat/completions`
const trigger = String.fromCharCode(91, 91) + 'REWRITE-PROBE' + String.fromCharCode(93, 93)
const replacement = '[[REWRITTEN]]'
const body = JSON.stringify({ messages: [{ role: 'user', content: trigger }] })
const send = () => fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(5000) })
try {
  apply(ctx, { routes: [], panel: { enabled: false } })
  assert.equal((await send()).status, 200)
  assert.equal(received.at(-1), body)
  console.log('未注册改写器：服务端收到原文，200')

  const unregister = ctx.get('requestRewrite').register('context-care', createRequestRewriter({
    rules: () => [{
      id: 'probe-request-rewrite', order: 999, placement: ['request'],
      when: { findRegex: '/\\[\\[REWRITE-PROBE\\]\\]/g', replaceString: '[[REWRITTEN]]' },
      action: { kind: 'transform' }, budget: { maxCacheLoss: 1 },
    }],
    onRecord: record => console.log('context-care 规则结果：', record.outcome),
  }))
  assert.equal((await send()).status, 200)
  const rewritten = JSON.parse(received.at(-1)).messages[0].content
  assert.equal(rewritten, replacement)
  assert.notEqual(rewritten, trigger)
  console.log('注册并命中改写：服务端收到替换文本，且与输入不同，200')
  unregister()
  assert.equal((await send()).status, 200)
  assert.equal(received.at(-1), body)
  console.log('注销改写器：服务端恢复收到原文，200')

  // 明确验证失败不能继续发网，也不能丢失原始异常对象及其 cause。
  const cause = new Error('local verification cause')
  const failure = new Error('local verification rewrite failure', { cause })
  const offFailure = ctx.get('requestRewrite').register('broken', () => { throw failure })
  await assert.rejects(send, error => error === failure && error.cause === cause)
  offFailure()
  const offInvalid = ctx.get('requestRewrite').register('invalid', () => 42)
  await assert.rejects(send, /改写器 "invalid" 返回的不是字符串/)
  offInvalid()
  assert.equal(received.length, 3)
  console.log('改写异常及非法返回：均拒绝发送；原始异常与 cause 保留')
} finally {
  await ctx.fiber.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  assert.equal(globalThis.fetch, originalFetch)
}
