import { applyBlockPatchesV2, bindInputs } from '@leolee9086/dsh-rule-engine'
import { createHash } from 'node:crypto'
import { setRequestBlock } from './request-blocks.js'
import { estimateInjection, requestImpact } from './request-impact.js'

function ownedRequest(request) {
  // Cancellation and prepared-call handles stay native. Clone only the JSON request payload.
  return { ...request, messages: structuredClone(request.messages) }
}
function pairedIds(request) {
  const calls = new Set(request.messages.flatMap(message => message.content.filter(block => block.type === 'tool-call').map(block => block.id)))
  const results = new Set(request.messages.filter(message => message.role === 'tool').map(message => message.toolCallId))
  return { calls, results }
}
function patchArguments(argumentsValue, pointer, value) {
  const out = structuredClone(argumentsValue)
  if (!pointer.startsWith('/') || !pointer.slice(1)) throw new Error('tool-argument-patch-requires-property')
  const keys = pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'))
  if (keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('tool-argument-patch-unsafe-path')
  let parent = out
  for (const key of keys.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new Error('tool-argument-patch-missing-path')
    parent = parent[key]
  }
  if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, keys.at(-1))) throw new Error('tool-argument-patch-missing-path')
  parent[keys.at(-1)] = value
  return out
}
const evidenceActionKey = (event, action) => JSON.stringify([event.sourceId, event.ruleId, event.occurrenceId, action.id])

/** Plan against an immutable request. Cache-budget exclusions are recorded and replan dependencies; character and byte errors remain explicit failures. */
export function planRequestV2(input) {
  const excluded = new Set()
  const rank = new Map(input.rules.map(rule => [JSON.stringify([rule.sourceId, rule.id]), rule.priority]))
  for (;;) {
    const planned = planRequest({ ...input, decision(event, action) {
      return excluded.has(evidenceActionKey(event, action)) ? { enabled: false, reason: 'request-cache-change-budget-exceeded' } : input.decision(event, action)
    } })
    if (input.maxCacheChangedBytes === undefined || planned.impact.changedSuffixBytes <= input.maxCacheChangedBytes) return planned
    const candidates = planned.applied.filter(item => ['inject', 'guidance', 'replace', 'filter'].includes(item.action.kind))
    // Remove the last candidate in stable engine order at the lowest rank. Each retry removes an
    // accepted action, so planning cannot loop without reducing the candidate set.
    candidates.sort((a, b) => (rank.get(JSON.stringify([b.event.sourceId, b.event.ruleId])) ?? 0) - (rank.get(JSON.stringify([a.event.sourceId, a.event.ruleId])) ?? 0))
    const last = candidates.at(-1)
    if (!last) throw new Error('request-cache-change-budget-exceeded')
    excluded.add(evidenceActionKey(last.event, last.action))
  }
}

function planRequest({ request, blocks, rules, events, templates, snapshot, decision, maxInjectedChars = 65536, maxRequestBytes = 8388608,
  maxInjectedTokens, impactBaseline = request, estimateMessage }) {
  const next = ownedRequest(request)
  const writableBlocks = blocks.filter(block => block.view === 'model')
  const patches = []; const filters = new Set(); const insertions = []; const records = []; const applied = []; const scheduled = []
  const injectedEntries = new Set(); const argumentPatches = new Map()
  const byRule = new Map(rules.map(rule => [JSON.stringify([rule.sourceId, rule.id]), rule]))
  const stateKey = (event, action) => JSON.stringify([event.sourceId, event.ruleId, event.ruleRevision, action.id])
  let injectedChars = 0; let injectedTokens = estimateMessage ? 0 : null
  // Stable sort preserves the shared engine's source/id order among equally ranked evidence.
  const prioritized = [...events].sort((a, b) => (byRule.get(JSON.stringify([b.sourceId, b.ruleId]))?.priority ?? 0) - (byRule.get(JSON.stringify([a.sourceId, a.ruleId]))?.priority ?? 0))
  for (const event of prioritized) {
    const rule = byRule.get(JSON.stringify([event.sourceId, event.ruleId]))
    if (!rule) throw new Error('request-plan-rule-unavailable')
    const actions = rule.actions.filter(action => action.stage === event.stage)
    const pending = new Set(actions)
    const outcomes = new Map()
    while (pending.size) {
      const action = [...pending].find(action => action.dependsOn.every(id => !pending.has(actions.find(item => item.id === id))))
      if (!action) throw new Error('request-plan-dependency-cycle')
      pending.delete(action)
      const eligible = decision(event, action)
      const record = { sourceId: event.sourceId, ruleId: event.ruleId, actionId: action.id, occurrenceId: event.occurrenceId,
        blockId: event.blockId, ranges: event.ranges, captures: event.captures, status: 'planned' }
      records.push(record)
      if (!eligible.enabled) { record.status = 'skipped'; record.reason = eligible.reason; outcomes.set(action.id, false); continue }
      if (action.dependsOn.some(id => outcomes.get(id) === false)) { record.status = 'skipped'; record.reason = 'dependency-not-planned'; outcomes.set(action.id, false); continue }
      const key = stateKey(event, action)
      if (event.ruleId.startsWith('entry:') && injectedEntries.has(key)) { record.status = 'skipped'; record.reason = 'entry-already-selected'; continue }
      const context = { ...snapshot, captures: event.captures, facts: event.facts, block: event.block,
        tool: { name: event.block.raw?.name, arguments: event.block.arguments, result: event.block.raw?.content }, results: snapshot.results ?? {} }
      const deferred = action.dependsOn.length > 0 && (event.stage !== 'request.assemble' || ['program', 'tool', 'job', 'set-variable', 'notify', 'abort', 'resume', 'compact'].includes(action.kind))
      // A persisted entry contains rendered text, including literal template delimiters.
      // Reusing it must not interpret those delimiters a second time.
      const text = action.template === undefined || deferred ? undefined
        : Object.hasOwn(snapshot.materializations ?? {}, key) ? snapshot.materializations[key] : templates.render(action.template, context)
      if (text !== undefined && text.length > (action.maxChars ?? maxInjectedChars)) throw new Error('action-output-budget-exceeded')
      const block = writableBlocks.find(value => value.id === event.blockId)
      if (action.kind === 'replace' && event.block.text !== undefined && block?.text !== event.block.text) throw new Error('replacement-projection-range-unavailable')
      if (action.kind === 'replace') {
        if (!block) throw new Error('replacement-cross-block-requires-explicit-patches')
        if (action.patch?.kind === 'tool-arguments') {
          if (block.type !== 'tool-call' || block.argumentsError) throw new Error('tool-argument-patch-needs-valid-json-call')
          if (block.source?.replayState !== undefined) throw new Error('replacement-opaque-provider-state-denied')
          const changes = argumentPatches.get(block.id) ?? []
          if (changes.some(change => change.path === action.patch.path || change.path.startsWith(action.patch.path + '/') || action.patch.path.startsWith(change.path + '/'))) {
            record.status = 'skipped'; record.reason = 'overlapping-argument-patch'; outcomes.set(action.id, false); continue
          }
          const currentArgs = changes.at(-1)?.value ?? block.arguments
          const value = patchArguments(currentArgs, action.patch.path, bindInputs(action.patch.value, context))
          changes.push({ path: action.patch.path, value }); argumentPatches.set(block.id, changes)
          setRequestBlock(next, block, { ...block.raw, arguments: JSON.stringify(value) })
          record.before = JSON.stringify(currentArgs); record.after = JSON.stringify(value)
        } else {
          if ((event.field ?? 'block.text') !== 'block.text') throw new Error('replacement-evidence-is-not-block-text')
          const ranges = event.ranges.length ? event.ranges : [[0, block.text?.length ?? 0]]
          const candidates = ranges.map(range => ({ blockId: block.id, actionId: `${event.occurrenceId}:${action.id}`, priority: rule.priority, range, text }))
          const checked = applyBlockPatchesV2(writableBlocks, [...patches, ...candidates])
          const accepted = checked.results.filter(result => result.actionId === `${event.occurrenceId}:${action.id}` && result.status === 'planned')
          if (!accepted.length) { record.status = 'skipped'; record.reason = 'overlapping-patch'; outcomes.set(action.id, false); continue }
          patches.push(...candidates)
        }
      } else if (action.kind === 'filter') {
        if (!block) throw new Error('filter-cross-block-requires-explicit-targets')
        if (block.signed || block.source?.replayState !== undefined) throw new Error('filter-opaque-provider-state-denied')
        if (block.callId) {
          const group = blocks.filter(value => value.callId === block.callId)
          if (group.some(candidate => candidate.signed || candidate.source?.replayState !== undefined)) throw new Error('filter-opaque-provider-state-denied')
          for (const candidate of group) filters.add(candidate.id)
          record.reason = 'tool-call-result-group'
        } else filters.add(block.id)
      } else if (['inject', 'guidance'].includes(action.kind) && event.stage === 'request.assemble') {
        const target = action.target ?? { view: 'model', role: 'user', anchor: 'end', position: 'after' }
        if (target.view !== 'model') throw new Error('request-injection-view-mismatch')
        if (target.role === 'tool') throw new Error('tool-role-injection-requires-real-result')
        if (target.role === 'system' && !['start', 'end'].includes(target.anchor)) throw new Error('system-injection-anchor-unavailable')
        let at
        if (target.anchor === 'end') at = next.messages.length
        else if (target.anchor === 'start') at = 0
        else if (target.anchor === 'depth') {
          if (!Number.isSafeInteger(target.depth) || target.depth > next.messages.length) {
            record.status = 'skipped'; record.reason = 'injection-depth-anchor-unavailable'; outcomes.set(action.id, false); continue
          }
          at = next.messages.length - target.depth
        } else {
          const anchor = target.anchor === 'matched' ? block : writableBlocks.find(value => value.id === target.anchor)
          if (!anchor || anchor.messageIndex < 0) {
            record.status = 'skipped'; record.reason = 'injection-anchor-unavailable'; outcomes.set(action.id, false); continue
          }
          at = anchor.messageIndex + (target.position === 'before' ? 0 : 1)
        }
        // Character errors remain fatal and explicit. Token admission may skip a whole
        // injection, never a text prefix, tool group, JSON value or signed block.
        if (injectedChars + text.length > maxInjectedChars) throw new Error('total-injection-budget-exceeded')
        const tokens = estimateInjection({ role: target.role ?? 'user', content: [{ type: 'text', text }] }, estimateMessage)
        if (maxInjectedTokens !== undefined && (tokens === null || injectedTokens + tokens > maxInjectedTokens)) {
          record.status = 'skipped'; record.reason = tokens === null ? 'injection-token-estimate-unavailable' : 'injection-token-budget-exceeded'
          record.estimatedTokens = tokens; outcomes.set(action.id, false); continue
        }
        injectedChars += text.length
        if (tokens !== null) injectedTokens += tokens
        insertions.push({ at, origin: block?.messageIndex ?? event.block.seq, priority: rule.priority, key, role: target.role ?? 'user', text, event, action })
        if (event.ruleId.startsWith('entry:')) injectedEntries.add(key)
      } else if (['program', 'tool', 'job', 'set-variable', 'notify', 'abort', 'resume', 'compact', 'inject', 'guidance'].includes(action.kind)) {
        scheduled.push({ event, action, context, inputs: action.inputs === undefined || deferred ? undefined : bindInputs(action.inputs, context),
          inputsDeferred: deferred, templateDeferred: deferred && action.template !== undefined, text })
      } else throw new Error(`request-action-unavailable:${action.kind}`)
      outcomes.set(action.id, true)
      applied.push({ event, action, key, ...(text === undefined ? {} : { text }) })
    }
  }
  const patched = applyBlockPatchesV2(writableBlocks, patches)
  for (const block of patched.blocks) if (block !== writableBlocks.find(value => value.id === block.id) && !filters.has(block.id)) setRequestBlock(next, block, block.raw)
  // Deletions run deepest and rightmost first so they never shift an outstanding path.
  for (const block of writableBlocks.filter(block => filters.has(block.id)).sort((a, b) => b.messageIndex - a.messageIndex || b.path.localeCompare(a.path, undefined, { numeric: true }))) {
    if (block.path === '$result') { next.messages[block.messageIndex].content = []; continue }
    if (blocks.some(parent => filters.has(parent.id) && parent.path !== '$result' && block.path.startsWith(parent.path + '.') && parent.messageIndex === block.messageIndex)) continue
    if (next.messages[block.messageIndex]?.content.length || block.messageIndex === -1) setRequestBlock(next, block, undefined)
  }
  for (const insertion of [...insertions].sort((a, b) => b.at - a.at || a.priority - b.priority || b.key.localeCompare(a.key))) {
    if (insertion.role === 'system') {
      next.system = insertion.at === 0 ? insertion.text + '\n' + (next.system ?? '') : (next.system ?? '') + '\n' + insertion.text
    } else {
      // Request-only messages keep a deterministic id; no committed source message is edited.
      const id = createHash('sha256').update(JSON.stringify([insertion.key, insertion.at, insertion.origin, insertion.event.block.path,
        insertion.event.ranges, insertion.text])).digest('hex')
      next.messages.splice(insertion.at, 0, { id: `context-care:${id}`, role: insertion.role, content: [{ type: 'text', text: insertion.text }],
        source: { kind: 'plugin:dsh-context-care:workbench', contextCareWorkbench: { sourceId: insertion.event.sourceId, ruleId: insertion.event.ruleId, actionId: insertion.action.id } } })
    }
  }
  next.messages = next.messages.filter(message => message.content.length > 0)
  const beforePairs = pairedIds(request); const afterPairs = pairedIds(next)
  for (const id of beforePairs.calls) if (beforePairs.results.has(id) && afterPairs.calls.has(id) !== afterPairs.results.has(id)) throw new Error('tool-call-result-pair-broken')
  const impact = requestImpact(impactBaseline, next)
  if (impact.afterBytes > maxRequestBytes) throw new Error('request-byte-budget-exceeded')
  return { request: next, records: [...records, ...patched.results], applied, scheduled, injectedChars,
    injectionBudget: { kind: injectedTokens === null ? 'unknown' : 'estimate', tokens: injectedTokens, limit: maxInjectedTokens ?? null }, impact,
    diff: { before: { system: request.system, messages: request.messages }, after: { system: next.system, messages: next.messages } } }
}
