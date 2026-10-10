import { V2_STAGES } from '@leolee9086/dsh-rule-engine'
import { detectorCallbackSource, detectorValidator, assertDetectorJson } from './detector-protocol.js'
import { builtinDetectorSpecifications } from './builtin-detectors.js'
import { releaseResources } from './resource-cleanup.js'

const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max
/** Owned plugin contributions and ephemeral per-request state; never shared between sessions or previews. */
export function createDetectorRegistry(matcher, { maxScopes = 128, maxStateBytes = 4194304 } = {}) {
  const registrations = new Map(); const scopes = new Map(); const active = new Set()
  const feeds = new Map(); const resets = new Map(); let generation = 0; let closed = false
  const overlaps = (a, b) => !a || !b || a === b
  const lookup = (ref, sessionId) => [...registrations.values()].find(spec => spec.ref === ref && (!spec.sessionId || spec.sessionId === sessionId))
  const register = (input, internal = false) => {
    if (closed) throw new Error('detector-registry-closed')
    if (registrations.size >= 128) throw new Error('detector-registration-budget-exceeded')
    if (!input || Object.keys(input).some(key => !['plugin', 'ref', 'revision', 'sessionId', 'on', 'paramsSchema', 'stateSchema', 'resultSchema', 'timeoutMs', 'maxStateBytes', 'maxResultBytes', 'callbacks', ...(internal ? ['builtin'] : [])].includes(key))) throw new Error('detector-invalid-registration-field')
    const { plugin, ref, revision, sessionId, on, paramsSchema, stateSchema, resultSchema, timeoutMs = 50, maxStateBytes = 262144, maxResultBytes = 65536 } = input
    if ([plugin, ref].some(value => typeof value !== 'string' || !value || value.length > 256) || sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId)
      || !bounded(revision, 1, Number.MAX_SAFE_INTEGER) || !Array.isArray(on) || !on.length || on.some(stage => !V2_STAGES.includes(stage))) throw new Error('detector-invalid-registration')
    if (!bounded(timeoutMs, 1, 100) || !bounded(maxStateBytes, 1, 1048576) || !bounded(maxResultBytes, 1, 1048576)) throw new Error('detector-invalid-budget')
    if ([...registrations.values()].some(spec => spec.ref === ref && overlaps(spec.sessionId, sessionId))) throw new Error('detector-registration-conflict')
    for (const schema of [paramsSchema, stateSchema, resultSchema]) detectorValidator(schema)
    if (input.builtin && !internal) throw new Error('detector-builtin-reserved')
    const callbacks = input.builtin ? undefined : Object.fromEntries(['initialize', 'feed', 'finalize', 'reset'].map(name => [name, detectorCallbackSource(input.callbacks?.[name])]))
    const spec = structuredClone({ plugin, ref, revision, ...(sessionId ? { sessionId } : {}), on, paramsSchema, stateSchema, resultSchema, timeoutMs, maxStateBytes, maxResultBytes,
      ...(input.builtin ? { builtin: input.builtin } : { callbacks }) })
    const key = JSON.stringify([ref, sessionId ?? null]); registrations.set(key, spec); generation++
    return async () => {
      if (registrations.get(key) !== spec) return
      registrations.delete(key); generation++
      const runs = [...active].filter(run => run.specifications.includes(spec))
      for (const run of runs) run.controller.abort(new Error('detector-disposed'))
      await Promise.allSettled(runs.map(run => run.done))
      await releaseResources([...scopes].filter(([, scope]) => scope.specifications.includes(spec)).map(([id]) => [`detector-scope:${id}`, () => release(id, 'detector-disposed')]))
    }
  }
  const release = async (id, reason = 'stream-closed', preserveFeed = false) => {
    if (!preserveFeed && feeds.has(id)) feeds.get(id).cancelled = true
    if (resets.has(id)) {
      try { await resets.get(id) }
      catch (error) { await releaseResources([['remaining detector state', () => release(id, reason, preserveFeed)]], error); throw error }
      return release(id, reason, preserveFeed)
    }
    const scope = scopes.get(id)
    if (!scope) return
    scopes.delete(id)
    // Reserve the reset interval as well as the worker interval: no new feed may overtake it.
    const resetting = (async () => {
      const runs = [...active].filter(run => run.scope === id)
      for (const run of runs) run.controller.abort(new Error(reason))
      await Promise.allSettled(runs.map(run => run.done))
      if (Object.keys(scope.states).length) await matcher.detect({ detectorSpecifications: scope.specifications, detectorStates: scope.states, detectorReset: reason })
    })()
    resets.set(id, resetting)
    try { await resetting } finally { if (resets.get(id) === resetting) resets.delete(id) }
  }
  for (const spec of builtinDetectorSpecifications) register(spec, true)
  const detect = async (input, signal, { sessionId, scope, epoch, current = () => true } = {}) => {
      if (closed) throw new Error('detector-registry-closed')
      const captured = generation
      const specifications = []
      const rules = input.rules.filter(rule => {
        if (rule.match.kind !== 'detector') return true
        const spec = lookup(rule.match.ref, sessionId)
        if (!spec || spec.revision !== rule.match.revision || !spec.on.includes(input.stage)) return false
        // Schema regex validation also runs in the abortable worker, never on the Host thread.
        if (!specifications.includes(spec)) specifications.push(spec)
        return true
      })
      if (scope && (typeof scope !== 'string' || typeof sessionId !== 'string' || !sessionId)) throw new Error('detector-stream-identity-required')
      if (scope && scopes.has(scope) && scopes.get(scope).sessionId !== sessionId) throw new Error('detector-stream-session-conflict')
      if (scope && scopes.get(scope)?.busy) throw new Error('detector-stream-concurrent-feed')
      if (scope && scopes.has(scope) && scopes.get(scope).epoch !== epoch) await release(scope, 'policy-changed', true)
      if (!specifications.length) {
        if (scope) await release(scope, 'detectors-inactive', true)
        if (closed || generation !== captured || !current()) throw new Error('detector-policy-changed')
        return matcher.detect({ ...input, rules }, signal)
      }
      if (closed || generation !== captured || !current()) throw new Error('detector-policy-changed')
      if (signal?.aborted) throw signal.reason ?? new Error('detector-cancelled')
      if (scope && !scopes.has(scope) && scopes.size >= maxScopes) throw new Error('detector-scope-budget-exceeded')
      const held = scope ? scopes.get(scope) ?? { states: {}, specifications, epoch, sessionId, busy: false } : { states: {} }
      if (scope) { held.busy = true; scopes.set(scope, held) }
      const controller = new AbortController(); const abort = () => controller.abort(signal.reason)
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
      const run = { controller, specifications, scope, done: undefined }
      active.add(run)
      run.done = (async () => {
        try {
          const output = await matcher.detect({ ...input, rules, detectorSpecifications: specifications, detectorStates: held.states }, controller.signal)
          if (closed || controller.signal.aborted || generation !== captured || !current() || scope && scopes.get(scope) !== held) throw new Error('detector-policy-changed')
          assertDetectorJson(output.states)
          if (scope) {
            const states = { ...held.states }
            for (const [key, value] of Object.entries(output.states)) { if (value === null) delete states[key]; else states[key] = value }
            const retainedBytes = [...scopes.values()].filter(value => value !== held).reduce((bytes, value) => bytes + Buffer.byteLength(JSON.stringify(value.states), 'utf8'), 0)
            if (retainedBytes + Buffer.byteLength(JSON.stringify(states), 'utf8') > maxStateBytes) throw new Error('detector-stream-state-budget-exceeded')
            held.states = states; held.specifications = [...new Set([...held.specifications, ...specifications])]
          }
          return output.events
        } finally { held.busy = false; signal?.removeEventListener('abort', abort); active.delete(run) }
      })()
      return run.done
  }
  return {
    register: specification => register(specification),
    token: () => generation,
    available(rule, sessionId, stage) { const spec = lookup(rule.match.ref, sessionId); return spec?.revision === rule.match.revision && spec.on.includes(stage) },
    catalog: () => [...registrations.values()].map(({ callbacks, ...spec }) => structuredClone(spec)),
    async detect(input, signal, options = {}) {
      const { scope } = options
      if (!scope) return detect(input, signal, options)
      if (feeds.has(scope) || resets.has(scope)) throw new Error('detector-stream-concurrent-feed')
      const claim = { cancelled: false, done: undefined }; feeds.set(scope, claim)
      const current = options.current ?? (() => true)
      claim.done = detect(input, signal, { ...options, current: () => !claim.cancelled && current() })
      try { return await claim.done } finally { if (feeds.get(scope) === claim) feeds.delete(scope) }
    },
    release: (id, reason) => release(id, reason),
    async releaseBlock(scopeId, blockKey) {
      if (feeds.has(scopeId) || resets.has(scopeId)) throw new Error('detector-stream-concurrent-feed')
      const scope = scopes.get(scopeId)
      if (!scope) return
      const states = Object.fromEntries(Object.entries(scope.states).filter(([, value]) => value.blockKey === blockKey))
      for (const key of Object.keys(states)) delete scope.states[key]
      if (Object.keys(states).length) {
        const resetting = matcher.detect({ detectorSpecifications: scope.specifications, detectorStates: states, detectorReset: 'block-ended' })
        resets.set(scopeId, resetting)
        try { await resetting } finally { if (resets.get(scopeId) === resetting) resets.delete(scopeId) }
      }
    },
    async close() {
      closed = true; generation++
      for (const claim of feeds.values()) claim.cancelled = true
      for (const run of active) run.controller.abort(new Error('detector-registry-closed'))
      await Promise.allSettled([...active].map(run => run.done).concat([...feeds.values()].map(claim => claim.done), [...resets.values()]))
      try { await releaseResources([...scopes.keys()].map(id => [`detector-scope:${id}`, () => release(id, 'host-closed')])) }
      finally { scopes.clear(); registrations.clear(); feeds.clear(); resets.clear() }
    },
  }
}
