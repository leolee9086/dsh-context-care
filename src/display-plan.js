import { applyBlockPatchesV2 } from '@leolee9086/dsh-rule-engine'
import { indexFirstRules } from '../lib/request-rule-index.js'
import { indexRequestActions } from '../lib/request-action-order.js'
import { indexDisplayBlocks, mergeDisplayInsertions } from '../lib/display-plan-index.js'

const viewBlock = block => ({ id: block.id, seq: block.seq, path: block.path, role: block.role, type: block.type, text: block.text })
/** Plan a read-only comparison for one committed message. Every patch uses baseline UTF-16 ranges. */
export function planDisplayV2({ blocks, rules, events, templates, snapshot, decision, maxInjectedChars, maxBytes, analysis = /** @type {ReturnType<typeof import('../lib/display-plan-index.js').createDisplayPlanCache> | undefined} */ (undefined) }) {
  const indexed = analysis ? analysis.blocks(blocks) : indexDisplayBlocks(blocks), baseline = indexed.baseline
  const patches = []; const filtered = new Set(); const checkedFilters = new Set(); const insertions = []; const records = []
  let injectedChars = 0
  const byRule = analysis ? analysis.rules(rules) : indexFirstRules(rules), orders = new Map()
  for (const event of events) {
    const rule = byRule.get(JSON.stringify([event.sourceId, event.ruleId]))
    if (!rule) throw new Error('display-rule-unavailable')
    let stages = analysis ? analysis.actions(rule.actions) : orders.get(rule.actions)
    if (!stages) { stages = indexRequestActions([...new Set(rule.actions.filter(action => action.stage === 'display.render'))]); orders.set(rule.actions, stages) }
    const ordered = stages.get('display.render'), outcomes = new Map()
    for (const action of ordered?.order ?? []) {
      const record = { sourceId: event.sourceId, ruleId: event.ruleId, actionId: action.id, blockId: event.blockId, ranges: event.ranges, status: 'planned' }
      records.push(record)
      const eligibility = decision(event, action)
      if (!eligibility.enabled || action.dependsOn.some(id => outcomes.get(id) !== true)) {
        record.status = 'skipped'; record.reason = eligibility.enabled ? 'dependency-not-planned' : eligibility.reason
        outcomes.set(action.id, false); continue
      }
      const block = indexed.first(event.blockId)
      if (!block || event.segments) throw new Error('display-cross-block-write-unavailable')
      const context = { ...snapshot, captures: event.captures, facts: event.facts, block: event.block,
        tool: { name: event.block.raw?.name, arguments: event.block.arguments, result: event.block.raw?.content } }
      const text = action.template === undefined ? undefined : templates.render(action.template, context)
      if (text !== undefined && text.length > (action.maxChars ?? maxInjectedChars)) throw new Error('display-action-output-budget-exceeded')
      if (action.kind === 'replace') {
        if (action.patch || (event.field ?? 'block.text') !== 'block.text' || block.text !== event.block.text) throw new Error('display-text-range-unavailable')
        const candidates = (event.ranges.length ? event.ranges : [[0, block.text?.length ?? 0]])
          .map(range => ({ blockId: block.id, actionId: `${event.occurrenceId}:${action.id}`, priority: rule.priority, range, text }))
        const checked = applyBlockPatchesV2(baseline, [...patches, ...candidates])
        if (!checked.results.some(result => result.actionId === `${event.occurrenceId}:${action.id}` && result.status === 'planned')) {
          record.status = 'skipped'; record.reason = 'overlapping-patch'; outcomes.set(action.id, false); continue
        }
        patches.push(...candidates)
      } else if (action.kind === 'filter') {
        if (!checkedFilters.has(block.id)) {
          const group = indexed.filterGroup(block)
          if (group.some(candidate => candidate.signed || candidate.replayState !== undefined)) throw new Error('display-opaque-filter-denied')
          group.forEach(candidate => filtered.add(candidate.id)); checkedFilters.add(block.id)
        }
      } else if (action.kind === 'inject') {
        const target = action.target ?? { view: 'display', anchor: 'end', position: 'after' }
        if (target.view !== 'display' || target.lifetime && target.lifetime !== 'request') throw new Error('display-target-unavailable')
        let at
        if ((target.anchor ?? 'end') === 'end') at = baseline.length
        else if (target.anchor === 'start') at = 0
        else if (target.anchor === 'depth') {
          if (target.depth > 1) throw new Error('display-message-depth-unavailable')
          at = target.depth === 0 ? baseline.length : 0
        } else {
          at = indexed.position(target.anchor === 'matched' ? block.id : target.anchor)
          if (at < 0) throw new Error('display-anchor-unavailable')
          if (target.position !== 'before') at++
        }
        injectedChars += text.length
        if (injectedChars > maxInjectedChars) throw new Error('display-injection-budget-exceeded')
        insertions.push({ at, priority: rule.priority, block: { id: `display:${event.occurrenceId}:${action.id}`, role: target.role ?? block.role, type: 'text', text } })
      } else throw new Error(`display-action-unavailable:${action.kind}`)
      outcomes.set(action.id, true)
    }
    // Preserve the original executable prefix and its earlier decision/render
    // errors before reporting a remaining dependency cycle.
    if (ordered?.cycle) throw new Error('display-dependency-cycle')
  }
  const patched = applyBlockPatchesV2(baseline, patches)
  // Insert against baseline indices, then hide filtered originals. Insertions never acquire a committed seq.
  const output = mergeDisplayInsertions(patched.blocks.map(viewBlock), insertions)
  const result = { before: baseline.map(viewBlock), after: output.filter(block => !filtered.has(block.id)), records, patches: patched.results }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw new Error('display-result-budget-exceeded')
  return { ...result, changed: JSON.stringify(result.before) !== JSON.stringify(result.after) }
}
