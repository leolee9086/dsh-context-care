import Ajv from 'ajv'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from './message.js'
import { bindInputs } from '@leolee9086/dsh-rule-engine'
import { createActionCapacity, awaitApproval } from './action-capacity.js'
import { releaseResources } from './resource-cleanup.js'
import { recordSecondaryFailure } from './secondary-failure.js'
import { ControlError } from './rule-controls.js'

const terminal = new Set(['succeeded', 'failed', 'skipped', 'cancelled', 'unknown'])
export const compactExecutorRef = 'context-care:compact'
const externalAction = action => ['program', 'tool', 'job', 'compact'].includes(action.kind)
/** Fixed tool mappings preserve the real Host policy pipeline. Captures supply JSON input, never an executor name. */
export function createExecutorRegistry({ tools }) {
  const ajv = new Ajv({ strict: true, allErrors: true, validateFormats: false })
  const executors = new Map(); let generation = 0
  return {
    registerTool({ executorRef, plugin, toolName, inputSchema, requiresApproval = true, timeoutMs = 10000, maxResultBytes = 65536 }) {
      if (!executorRef || !plugin || !toolName || executors.has(executorRef)) throw new Error('executor-registration-conflict')
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 86400000 || !Number.isSafeInteger(maxResultBytes) || maxResultBytes < 1) throw new Error('executor-invalid-budget')
      const validate = ajv.compile(inputSchema)
      const executor = { executorRef, plugin, toolName, requiresApproval, timeoutMs, maxResultBytes, validate,
        async run({ agent, inputs, signal, runId }) {
          // Do not create parent execution tokens to bypass native/PTC restrictions.
          const result = await tools.execute({ callId: `context-care:${runId}`, name: toolName, arguments: inputs, agent, signal })
          if (result.isError) throw Object.assign(new Error(result.error?.message ?? result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')), { code: result.error?.code ?? 'EXECUTOR_FAILED' })
          if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxResultBytes) throw Object.assign(new Error('executor-result-budget-exceeded'), { outcomeUnconfirmed: true })
          return { value: result.value ?? null, content: result.content }
        } }
      executors.set(executorRef, executor); generation++
      return () => { if (executors.get(executorRef) === executor) { executors.delete(executorRef); generation++ } }
    },
    get: id => executors.get(id),
    token: () => generation,
    catalog: () => [...executors.values()].map(({ executorRef, plugin, toolName, requiresApproval, timeoutMs, maxResultBytes }) => ({ executorRef, plugin, toolName, requiresApproval, timeoutMs, maxResultBytes, available: tools.get(toolName) !== undefined })),
    close() { executors.clear(); generation++ },
  }
}
/** Durable queued tasks start at an open Agent step. Unknown crash outcomes are never replayed automatically. */
export function createActionRuns({ store, registry, approvalFor, guard, templates, setVariable, maxQueued = 128, maxConcurrent = 8, report = () => {}, now = () => Date.now() }) {
  const pending = new Map(); const running = new Map(); const draining = new Map(); const enqueuing = new Set()
  const acquire = createActionCapacity(maxConcurrent)
  let closed = false; let closing
  const keyOf = item => JSON.stringify([item.event.sourceId, item.event.ruleId, item.event.ruleRevision, item.action.id])
  async function state(sessionId, id, update) {
    await store.runtime(sessionId, runtime => {
      const run = runtime.runs.find(run => run.id === id)
      if (!run) throw new Error('action-run-unavailable')
      Object.assign(run, update, { updatedAt: now() })
    })
  }
  return {
    async recover() {
      for (const id of store.sessions()) {
        const stale = store.read(id).runtime.runs.filter(run => !terminal.has(run.status))
        if (stale.length) await store.runtime(id, runtime => {
          for (const run of runtime.runs.filter(run => stale.some(item => item.id === run.id))) {
            if (run.status === 'running' && ['notify', 'guidance', 'inject'].includes(run.kind)) run.delivery = 'unknown'
            run.status = run.status === 'running' ? 'unknown' : 'skipped'
            run.reason = 'host-restarted'; run.updatedAt = now()
          }
        })
      }
    },
    enqueue(sessionId, items, token) {
      if (closed) return Promise.reject(new Error('action-runs-closed'))
      if (!items.length) return Promise.resolve([])
      const operation = (async () => {
      const queue = pending.get(sessionId) ?? []
      pending.set(sessionId, queue)
      const accepted = []
      await store.runtime(sessionId, runtime => {
        if (closed) throw new Error('action-runs-closed')
        const queued = runtime.runs.filter(run => !terminal.has(run.status)).length
        let newlyQueued = 0
        for (const item of items) {
          const gate = guard(sessionId, item.event, item.action, token, { dispatchId: item.dispatchId })
          const key = keyOf(item)
          const duplicate = runtime.runs.find(run => run.occurrenceId === item.event.occurrenceId && run.key === key)
          if (duplicate) continue
          const run = { id: randomUUID(), sessionId, key, occurrenceId: item.event.occurrenceId, sourceId: item.event.sourceId, ruleId: item.event.ruleId,
            ruleRevision: item.event.ruleRevision, actionId: item.action.id, executorRef: item.action.kind === 'compact' ? compactExecutorRef : item.action.executorRef ?? null,
            kind: item.action.kind, turnId: item.context.session.turnId, failurePolicy: item.action.failurePolicy ?? 'skip-dependents',
            status: gate.enabled ? 'queued' : 'skipped', reason: gate.enabled ? null : gate.reason, createdAt: now(), updatedAt: now(), inputs: item.inputs ?? null, sourceSeqs: item.event.sourceSeqs,
            ...(item.event.triggerSeq === undefined ? {} : { triggerSeq: item.event.triggerSeq }),
            controlToken: token, delivery: 'not-delivered' }
          if (gate.enabled && queued + ++newlyQueued > maxQueued) throw new Error('action-queue-budget-exceeded')
          runtime.runs.push(run); if (gate.enabled) accepted.push({ ...item, run, token })
        }
      })
      if (closed) {
        for (const item of accepted) await state(sessionId, item.run.id, { status: 'skipped', reason: 'host-closed' })
        return []
      }
      const eligible = accepted.filter(item => store.read(sessionId).runtime.runs.find(run => run.id === item.run.id)?.status === 'queued')
      queue.push(...eligible); pending.set(sessionId, queue)
      return eligible.map(item => item.run.id)
      })()
      enqueuing.add(operation)
      const release = () => enqueuing.delete(operation)
      operation.then(release, release)
      return operation
    },
    async drain(agent, signal) {
      const sessionId = String(agent.session.id)
      if (draining.has(sessionId)) return draining.get(sessionId)
      const operation = (async () => {
        const queue = pending.get(sessionId) ?? []
        while (queue.length && !closed) {
          const item = queue.shift(); const { run, action, event } = item
          // The durable status wins over a queue item captured before a cancellation ACK.
          if (store.read(sessionId).runtime.runs.find(value => value.id === run.id)?.status !== 'queued') continue
          if (signal?.aborted && action.kind !== 'resume') { await state(sessionId, run.id, { status: 'cancelled', reason: 'turn-cancelled-before-start' }); continue }
          let gate = guard(sessionId, event, action, item.token, { dispatchId: item.dispatchId })
          if (!gate.enabled) { await state(sessionId, run.id, { status: 'skipped', reason: gate.reason }); continue }
          const dependencies = store.read(sessionId).runtime.runs.filter(other => other.occurrenceId === event.occurrenceId && other.sourceId === event.sourceId
            && other.ruleId === event.ruleId && other.ruleRevision === event.ruleRevision && action.dependsOn.includes(other.actionId))
          // Continue permits a recorded failure only. Disabled, cancelled or unknown work never becomes a substitute success.
          if (action.dependsOn.length && (dependencies.length !== action.dependsOn.length || dependencies.some(other => other.status !== 'succeeded'
            && !(other.status === 'failed' && action.failurePolicy === 'continue')))) {
            await state(sessionId, run.id, { status: 'skipped', reason: 'dependency-not-succeeded' }); continue
          }
          const controller = new AbortController(); running.set(run.id, { controller, sessionId })
          let timer; let started = false; let completed = false; let deliveryAttempted = false; let delivered = false; let release
          // Use the hook's actual turn signal; Agent has no public signal property.
          const abortTurn = () => { if (action.kind !== 'abort' && action.kind !== 'resume') controller.abort(new Error('turn-cancelled')) }
          signal?.addEventListener('abort', abortTurn, { once: true })
          try {
            const context = { ...item.context, results: Object.fromEntries(dependencies.map(dependency => [dependency.actionId,
              dependency.status === 'succeeded' ? dependency.result?.value : { status: 'failed', reason: dependency.reason }])),
              outcomes: Object.fromEntries(dependencies.map(dependency => [dependency.actionId, { status: dependency.status, reason: dependency.reason ?? null }])) }
            const text = item.templateDeferred ? templates.render(action.template, context) : item.text
            if (text !== undefined && text.length > (action.maxChars ?? 65536)) throw new Error('action-output-budget-exceeded')
            const inputs = action.kind === 'compact' ? { note: text } : item.inputsDeferred && action.inputs !== undefined ? bindInputs(action.inputs, context) : item.inputs
            const executor = externalAction(action) ? registry.get(action.kind === 'compact' ? compactExecutorRef : action.executorRef) : undefined
            if (externalAction(action)) {
              if (!executor) throw new Error('executor-unavailable')
              if (!executor.validate(inputs)) throw new Error(`executor-input-invalid:${JSON.stringify(executor.validate.errors)}`)
              timer = setTimeout(() => controller.abort(new Error('action-timeout')), action.timeoutMs ?? executor.timeoutMs)
              release = await acquire(controller.signal)
              if (executor.requiresApproval) {
                const approval = approvalFor(agent)
                if (!approval) throw new Error('approval-unavailable')
                await state(sessionId, run.id, { status: 'waiting-approval' })
                const outcome = await awaitApproval(() => approval.request({ agent, toolName: executor.toolName, reason: `Context rule ${event.sourceId}/${event.ruleId}/${action.id}; inputs ${JSON.stringify(inputs)}`, signal: controller.signal }), controller.signal)
                if (outcome !== 'allowed-once') { await state(sessionId, run.id, { status: outcome === 'cancelled' ? 'cancelled' : 'skipped', reason: `approval-${outcome}` }); continue }
              }
            }
            gate = guard(sessionId, event, action, item.token, { dispatchId: item.dispatchId })
            if (!gate.enabled) { await state(sessionId, run.id, { status: 'skipped', reason: gate.reason }); continue }
            if (controller.signal.aborted) { await state(sessionId, run.id, { status: 'cancelled', reason: 'cancelled-before-start' }); continue }
            await state(sessionId, run.id, { status: 'running', startedAt: now() })
            gate = guard(sessionId, event, action, item.token, { dispatchId: item.dispatchId })
            if (!gate.enabled) { await state(sessionId, run.id, { status: 'skipped', reason: gate.reason }); continue }
            if (controller.signal.aborted || closed) { await state(sessionId, run.id, { status: 'cancelled', reason: 'cancelled-before-start' }); continue }
            started = true
            let result
            if (externalAction(action)) {
              result = await executor.run({ agent, inputs, signal: controller.signal, runId: run.id })
            } else if (action.kind === 'set-variable') {
              const value = bindInputs(action.value, context)
              if (setVariable) {
                const previous = item.token
                const updated = await setVariable(agent, item, value, context)
                const renewed = new Set([action.id])
                for (const dependent of queue) {
                  if (dependent.token !== previous || dependent.event.occurrenceId !== event.occurrenceId || dependent.event.sourceId !== event.sourceId
                    || dependent.event.ruleId !== event.ruleId || dependent.event.ruleRevision !== event.ruleRevision || !dependent.action.dependsOn.some(id => renewed.has(id))) continue
                  renewed.add(dependent.action.id); dependent.token = updated.token
                  dependent.context = { ...dependent.context, vars: updated.vars }
                  dependent.inputsDeferred = dependent.action.inputs !== undefined; dependent.templateDeferred = dependent.action.template !== undefined
                }
                item.token = updated.token
              } else {
                const declaration = store.read(sessionId).documents.flatMap(document => document.variables).find(variable => variable.name === action.variable)
                if (!declaration) throw new Error('variable-unavailable')
                await store.automaticVariable(sessionId, declaration, value, context.session.turnId)
              }
              result = { value }
            } else if (action.kind === 'abort') {
              agent.cancel({ kind: 'hook', reason: `context-rule:${event.sourceId}/${event.ruleId}/${action.id}` }, { keepInbox: true }); result = { value: 'abort-requested' }
            } else if (action.kind === 'resume') {
              if (typeof text !== 'string' || !text) throw new Error('resume-template-required')
              if (!dependencies.some(dependency => dependency.result?.value === 'abort-requested')) throw new Error('resume-requires-successful-abort')
              agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-context-care:workbench' } }))
              result = { value: 'resume-queued' }
            } else if (['notify', 'guidance', 'inject'].includes(action.kind)) {
              if (typeof text !== 'string') throw new Error('action-template-required')
              result = { value: text }
            }
            else throw new Error(`action-unavailable:${action.kind}`)
            if (['notify', 'guidance', 'inject'].includes(action.kind)) {
              const delivery = guard(sessionId, event, action, item.token, { delivery: true, dispatchId: item.dispatchId })
              if (!delivery.enabled || controller.signal.aborted || closed) {
                await state(sessionId, run.id, { status: 'skipped', reason: delivery.reason ?? 'delivery-cancelled' }); continue
              }
              // The running ACK reserves this occurrence. No await separates the final guard from durable inbox insertion.
              deliveryAttempted = true
              agent.send(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-context-care:workbench' } }), 'next-step', false)
              delivered = true
            }
            completed = true
            await store.runtime(sessionId, runtime => {
              Object.assign(runtime.runs.find(value => value.id === run.id), { status: controller.signal.aborted ? 'unknown' : 'succeeded',
                result: JSON.parse(JSON.stringify(result)), finishedAt: now(), updatedAt: now(), delivery: delivered ? 'delivered' : 'not-delivered',
                reason: controller.signal.aborted ? 'cancel-after-start-outcome-unconfirmed' : null })
              // Failed or unconfirmed attempts are retained in the ledger, but do not consume success cooldown or lifetime.
              if (!controller.signal.aborted) runtime.state[run.key] = { lastStarted: now(), occurrenceId: event.occurrenceId, turnId: item.context.session.turnId }
            })
          } catch (error) {
            report(error)
            try {
              await store.runtime(sessionId, runtime => {
                Object.assign(runtime.runs.find(value => value.id === run.id), { status: completed || deliveryAttempted || error.outcomeUnconfirmed || controller.signal.aborted && started ? 'unknown'
                  : controller.signal.aborted ? 'cancelled' : 'failed', reason: error.message, finishedAt: now(), updatedAt: now(),
                  delivery: delivered ? 'delivered' : deliveryAttempted ? 'unknown' : 'not-delivered' })
              })
            } catch (secondary) { recordSecondaryFailure(error, secondary, 'action-failure-ledger'); throw error }
          } finally { clearTimeout(timer); release?.(); signal?.removeEventListener('abort', abortTurn); running.delete(run.id) }
        }
      })()
      draining.set(sessionId, operation)
      try { await operation } finally { draining.delete(sessionId) }
    },
    async cancel(sessionId, runId) {
      const record = store.read(sessionId).runtime.runs.find(run => run.id === runId)
      if (!record) throw new ControlError(404, 'action-run-unavailable')
      const active = running.get(runId)
      if (active?.sessionId === sessionId) { active.controller.abort(new Error('action-cancel-requested')); await state(sessionId, runId, { cancellationRequested: true }); return }
      if (record.status === 'queued') {
        const queue = pending.get(sessionId) ?? []; const index = queue.findIndex(item => item.run.id === runId)
        if (index >= 0) queue.splice(index, 1)
        await state(sessionId, runId, { status: 'cancelled', reason: 'cancelled-before-start' })
      }
    },
    close() {
      if (closing) return closing
      closed = true
      for (const { controller } of running.values()) controller.abort(new Error('action-runs-closed'))
      closing = (async () => {
        // Failed enqueues have their own caller. Waiting prevents a late ACK from recreating a closed queue.
        await Promise.allSettled(enqueuing)
        const resources = [...pending].flatMap(([sessionId, queue]) => queue.map(item => [`queued-action:${item.run.id}`, async () => {
          if (store.read(sessionId).runtime.runs.find(run => run.id === item.run.id)?.status === 'queued')
            await state(sessionId, item.run.id, { status: 'skipped', reason: 'host-closed' })
        }]))
        resources.push(...[...draining.values()].map((operation, index) => [`draining-actions:${index}`, () => operation]))
        try { await releaseResources(resources) } finally { pending.clear() }
      })()
      return closing
    },
  }
}
