/** Authenticated, read-only display comparisons. Disconnecting terminates pending matching. */
export function installDisplayRoute(ctx) {
  return ctx.webServer.register({ kind: 'exact', path: '/context-care/display', async handler(req, res) {
    const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    const connection = ctx.get('connection')
    if (!connection) { respond(503, { error: 'authorization-unavailable' }); return }
    const denied = connection.requestRejection(req)
    if (denied !== undefined) { respond(denied, { error: 'unauthorized' }); return }
    if (req.method !== 'GET') { res.setHeader('allow', 'GET'); respond(405, { error: 'method-not-allowed' }); return }
    const query = new URL(req.url, 'http://localhost').searchParams
    const sessionId = query.get('sessionId'); const rawSeq = query.get('seq'); const seq = Number(rawSeq)
    if (!sessionId || !rawSeq || !/^\d+$/.test(rawSeq) || !Number.isSafeInteger(seq)) { respond(400, { error: 'invalid-display-query' }); return }
    const agent = ctx.agents.get(sessionId)
    if (!agent) { respond(404, { error: 'session-unavailable' }); return }
    const service = ctx.get('contextCareWorkbench')
    if (!service) { respond(503, { error: 'workbench-unavailable' }); return }
    const controller = new AbortController()
    const abort = () => controller.abort(new Error('display-client-disconnected'))
    res.once('close', abort)
    try {
      const projection = await service.display(agent, seq, controller.signal)
      if (!controller.signal.aborted) respond(200, { projections: projection.changed ? [projection] : [] })
    } catch (error) {
      if (!controller.signal.aborted) {
        ctx.logger.warn(`context-care: display failed: ${String(error)}`)
        respond(error.message === 'display-message-unavailable' ? 404 : 503, { error: 'display-unavailable', message: error.message })
      }
    } finally { res.removeListener('close', abort) }
  } })
}
