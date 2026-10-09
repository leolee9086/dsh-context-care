import { ControlPatch, ControlError } from './rule-controls.js'

/** Install authenticated session controls; authorization is required even on loopback. */
export function installControlRoute(ctx) {
  return ctx.webServer.register({ kind: 'exact', path: '/context-care/rules', async handler(req, res) {
    const respond = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    const connection = ctx.get('connection')
    if (connection === undefined) { respond(503, { error: 'authorization-unavailable' }); return }
    const rejected = connection.requestRejection(req)
    if (rejected !== undefined) { respond(rejected, { error: 'unauthorized' }); return }
    if (!['GET', 'PATCH'].includes(req.method)) { res.setHeader('allow', 'GET, PATCH'); respond(405, { error: 'method-not-allowed' }); return }
    const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId')
    if (!sessionId || !ctx.sessions.get(sessionId)) { respond(404, { error: 'session-unavailable' }); return }
    const controls = ctx.contextCareRequests.controls
    try {
      if (req.method === 'GET') { respond(200, controls.snapshot(sessionId)); return }
      // A same-origin JSON write cannot be submitted by a cross-origin HTML form.
      const origin = req.headers.origin
      if (origin) {
        let originHost
        try { originHost = new URL(origin).host }
        catch (error) {
          if (!(error instanceof TypeError)) throw error
          respond(403, { error: 'origin-rejected' }); return
        }
        if (originHost !== req.headers.host) { respond(403, { error: 'origin-rejected' }); return }
      }
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') { respond(415, { error: 'json-required' }); return }
      const parts = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 65536) { respond(413, { error: 'request-too-large' }); return }
        parts.push(chunk)
      }
      let change
      try { change = ControlPatch.parse(JSON.parse(Buffer.concat(parts.map(part => Buffer.from(part))).toString('utf8'))) }
      catch (error) {
        if (!(error instanceof SyntaxError) && error?.name !== 'ZodError') throw error
        respond(400, { error: 'invalid-control-request' }); return
      }
      respond(200, await controls.patch(sessionId, change))
    } catch (error) {
      if (error instanceof ControlError) {
        if (error.status >= 500) ctx.logger.warn(`context-care: control save failed: ${String(error.cause ?? error)}`)
        respond(error.status, { error: error.code })
      }
      else { ctx.logger.warn(`context-care: rule controls failed: ${String(error)}`); respond(503, { error: 'controls-unavailable' }) }
    }
  } })
}
