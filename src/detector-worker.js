import { createContext, Script } from 'node:vm'
import { validateDetectorEvidenceV2 } from '@leolee9086/dsh-rule-engine'
import { detectorValidator, validateDetectorValue, assertDetectorJson } from './detector-protocol.js'
import { builtinDetectorCallbacks } from './builtin-detectors.js'

const schemas = new Map()
/** Recreate callback realms per operation; cache only schema compilation, never implicit callback state. */
export function createWorkerDetectors(specifications, previous = {}) {
  const updated = {}; const runtimes = new Map()
  for (const spec of specifications) {
    const validateState = detectorValidator(spec.stateSchema, schemas); const validateResult = detectorValidator(spec.resultSchema, schemas)
    const validateParams = detectorValidator(spec.paramsSchema, schemas)
    let call
    if (spec.builtin) {
      const callbacks = builtinDetectorCallbacks(spec.builtin)
      call = (name, input) => callbacks[name](structuredClone(input))
    } else {
      const context = createContext({}, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' })
      new Script(`const callbacks = { ${Object.entries(spec.callbacks).map(([name, source]) => `${name}: (${source})`).join(',')} }; const assertDetectorJson = ${assertDetectorJson.toString()};`).runInContext(context, { timeout: spec.timeoutMs })
      call = (name, input) => {
        // Parse/validate/stringify inside the callback's realm. No Host references or closure values enter it.
        const text = new Script(`(() => { const output = callbacks.${name}(JSON.parse(${JSON.stringify(JSON.stringify(input))})); assertDetectorJson(output); return JSON.stringify(output) })()`)
          .runInContext(context, { timeout: spec.timeoutMs })
        return JSON.parse(text)
      }
    }
    runtimes.set(spec.ref, { spec, call, validateState, validateResult, validateParams })
  }
  return {
    updated,
    reset(reason) {
      for (const [key, held] of Object.entries(previous)) {
        const runtime = runtimes.get(JSON.parse(key)[4])
        if (!runtime) throw new Error('detector-reset-runtime-unavailable')
        const { spec, call, validateState } = runtime
        validateDetectorValue(validateState, call('reset', { params: held.params, state: held.state, reason }), 'state', spec.maxStateBytes)
      }
    },
    match(rule, snapshot) {
      const runtime = runtimes.get(rule.match.ref)
      if (!runtime || runtime.spec.revision !== rule.match.revision) throw new Error('detector-unavailable')
      const { spec, call, validateState, validateResult, validateParams } = runtime
      if (!spec.on.includes(snapshot.stage)) throw new Error('detector-stage-unavailable')
      const params = validateDetectorValue(validateParams, rule.match.params ?? {}, 'params', spec.maxStateBytes)
      const key = JSON.stringify([rule.sourceId, rule.id, rule.revision, snapshot.block.id, spec.ref, spec.revision, snapshot.block.view])
      const held = previous[key]
      const base = { params, block: snapshot.block, snapshot }
      let state = held ? held.state : call('initialize', base)
      state = validateDetectorValue(validateState, state, 'state', spec.maxStateBytes)
      const length = snapshot.block.text?.length ?? 0
      if (held && length < held.offset) throw new Error('detector-stream-prefix-changed')
      const delta = (snapshot.block.text ?? '').slice(held?.offset ?? 0)
      const fed = call('feed', { ...base, state, delta })
      if (!fed || Object.keys(fed).some(key => !['state', 'result'].includes(key)) || !Object.hasOwn(fed, 'state') || !Object.hasOwn(fed, 'result')) throw new Error('detector-invalid-feed-envelope')
      state = validateDetectorValue(validateState, fed.state, 'state', spec.maxStateBytes)
      let matched = validateDetectorEvidenceV2(validateDetectorValue(validateResult, fed.result, 'result', spec.maxResultBytes), snapshot.block)
      if (snapshot.stage !== 'output.delta' || snapshot.block.detectorPhase === 'finalize') {
        const final = call('finalize', { ...base, state, delta: '' })
        if (!final || Object.keys(final).some(key => !['state', 'result'].includes(key)) || !Object.hasOwn(final, 'state') || !Object.hasOwn(final, 'result')) throw new Error('detector-invalid-finalize-envelope')
        validateDetectorValue(validateState, final.state, 'state', spec.maxStateBytes)
        const finalized = validateDetectorEvidenceV2(validateDetectorValue(validateResult, final.result, 'result', spec.maxResultBytes), snapshot.block)
        if (finalized.ok || finalized.matches?.some(value => value.ok)) matched = finalized
        validateDetectorValue(validateState, call('reset', { ...base, state: final.state, reason: 'finalized' }), 'state', spec.maxStateBytes)
        updated[key] = null
      } else updated[key] = { state, offset: length, params, ...(snapshot.block.blockKey === undefined ? {} : { blockKey: snapshot.block.blockKey }) }
      return matched
    },
  }
}
