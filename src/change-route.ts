import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { createCareChanges, CareTopic } from './care-changes.js'

/** One authenticated stream multiplexes retained Sessions and coalesces backpressure. */
export function installChangeRoute(ctx: Context, changes: ReturnType<typeof createCareChanges>) {
  const streams = new Set<() => void>()
  const stop = ctx.webServer.register({ kind: 'exact', path: '/context-care/changes', handler(req, res) {
    const connection = ctx.get('connection')
    const rejected = connection === undefined ? 503 : connection.requestRejection(req)
    if (rejected !== undefined) { res.writeHead(rejected); res.end(); return }
    if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return }
    const ids = new Set(new URL(req.url ?? '/', 'http://localhost').searchParams.getAll('sessionId'))
    if (!ids.size || [...ids].some(id => !id)) { res.writeHead(400); res.end(); return }
    if ([...ids].some(id => !ctx.sessions.get(id as SessionId))) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    res.flushHeaders()
    let blocked = false
    let closed = false
    const pending = new Map<string, Set<CareTopic>>()
    const add = (id: string, topics: readonly CareTopic[]) => {
      let selected = pending.get(id)
      if (!selected) { selected = new Set(); pending.set(id, selected) }
      for (const topic of topics) selected.add(topic)
    }
    const flush = () => {
      if (closed || blocked) return
      for (const [sessionId, topics] of pending) {
        pending.delete(sessionId)
        if (!res.write(JSON.stringify({ sessionId, topics: [...topics] }) + '\n')) { blocked = true; break }
      }
    }
    const unsubscribe = changes.subscribe(change => {
      if (change.sessionId === undefined) { for (const id of ids) add(id, change.topics) }
      else if (ids.has(change.sessionId)) add(change.sessionId, change.topics)
      flush()
    })
    const drain = () => { blocked = false; flush() }
    const close = () => {
      if (closed) return
      closed = true; unsubscribe(); streams.delete(close); res.off('drain', drain); res.off('close', close); res.end()
    }
    streams.add(close); res.on('drain', drain); res.on('close', close)
    // A fresh cut follows subscription and covers changes during initial reads.
    for (const id of ids) add(id, ['actions', 'prompts', 'rewrites', 'controls', 'runtime'])
    flush()
  } })
  return () => { stop(); for (const close of [...streams]) close() }
}
