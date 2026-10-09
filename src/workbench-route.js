import { z } from 'zod'
import { ControlError } from './rule-controls.js'
import { runtimePage } from './rule-runtime-data.js'
import { PreviewWire } from './rule-runtime-wire.js'

// Only parsing request input is a client error. A broken response projection is
// a service failure and must remain visible as such.
const parseInput = parse => {
  try { return parse() } catch (error) { throw new ControlError(400, 'invalid-workbench-request', error) }
}
const Request = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('preview') }).strict(),
  z.object({ operation: z.literal('cancel'), runId: z.string().min(1) }).strict(),
])
/** Authenticated rule inspection and cancellation; rule declarations are never edited over HTTP. */
export function installWorkbenchRoute(ctx, path = '/context-care/workbench') {
  const management = path === '/context-care/rule-runtime'
  return ctx.webServer.register({ kind: 'exact', path, async handler(req, res) {
    const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    const connection = ctx.get('connection')
    if (!connection) { respond(503, { error: 'authorization-unavailable' }); return }
    const denied = connection.requestRejection(req)
    if (denied !== undefined) { respond(denied, { error: 'unauthorized' }); return }
    const id = new URL(req.url, 'http://localhost').searchParams.get('sessionId')
    const agent = id && ctx.agents.get(id)
    if (!agent) { respond(404, { error: 'session-unavailable' }); return }
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('allow', 'GET, POST'); respond(405, { error: 'method-not-allowed' }); return }
    const service = ctx.get('contextCareWorkbench')
    if (!service) { respond(503, { error: 'workbench-unavailable' }); return }
    try {
      if (req.method === 'GET' && management) {
        const query = new URL(req.url, 'http://localhost').searchParams
        const page = parseInput(() => z.object({ offset: z.coerce.number().int().min(0).max(100000), limit: z.coerce.number().int().min(1).max(100),
          status: z.enum(['', 'queued', 'waiting-approval', 'running', 'succeeded', 'failed', 'skipped', 'cancelled', 'unknown']), search: z.string().max(1024) })
          .parse({ offset: query.get('offset') ?? 0, limit: query.get('limit') ?? 20, status: query.get('status') ?? '', search: query.get('search') ?? '' }))
        respond(200, runtimePage(service.inspect(agent), page)); return
      }
      if (req.method === 'GET') {
        respond(200, { ...service.store.read(id, { presetId: service.presetId(agent) }), turnId: service.turnId(agent), sources: service.sources(id), executors: service.executors.catalog() }); return
      }
      if (req.headers.origin) {
        let originHost
        try { originHost = new URL(req.headers.origin).host }
        catch (error) { if (!(error instanceof TypeError)) throw error; respond(403, { error: 'origin-rejected' }); return }
        if (originHost !== req.headers.host) { respond(403, { error: 'origin-rejected' }); return }
      }
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') { respond(415, { error: 'json-required' }); return }
      const parts = []; let bytes = 0
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 1048576) { req.resume(); respond(413, { error: 'request-too-large' }); return }
        parts.push(Buffer.from(chunk))
      }
      const request = parseInput(() => Request.parse(JSON.parse(Buffer.concat(parts).toString('utf8'))))
      if (request.operation === 'cancel') {
        await service.cancel(id, request.runId); respond(200, management ? { sessionId: id, acknowledged: true } : service.store.read(id, { presetId: service.presetId(agent) }))
      } else {
        const snapshotId = service.snapshotId(agent)
        const messages = agent.session.deriveMessages()
        const header = agent.session.requestHeader()
        const modelRequest = { ...header?.config, tools: header?.tools, messages: messages.filter(message => message.role !== 'system'),
          system: messages.filter(message => message.role === 'system').flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n'), purpose: 'preview' }
        const planned = await service.preview(agent, modelRequest)
        if (snapshotId !== service.snapshotId(agent)) throw new ControlError(409, 'preview-context-changed')
        const preview = { sessionId: id, snapshotId, records: planned.records, diff: planned.diff, injectedChars: planned.injectedChars,
          injectionBudget: planned.injectionBudget, impact: planned.impact,
          documents: planned.documents, scheduled: planned.scheduled.map(job => ({ ruleId: job.event.ruleId, actionId: job.action.id, executorRef: job.action.executorRef,
            inputs: job.inputs, waitingForDependencies: job.inputsDeferred })) }
        respond(200, management ? PreviewWire.parse(JSON.parse(JSON.stringify(preview))) : preview)
      }
    } catch (error) {
      if (!(error instanceof ControlError)) ctx.logger.warn(`context-care: workbench request failed: ${String(error)}`)
      respond(error instanceof ControlError ? error.status : 503, { error: error.code ?? 'workbench-request-failed', message: error.message })
    }
  } })
}
