import { DETECTORS, createView, appendText, WINDOWED_EVERY } from './stream-watch.js'
import { detectDegradation, PATTERN_IDS } from './loop-patterns.js'
const empty = () => ({ ok: false, ranges: [], captures: {}, facts: {} })
const result = hit => hit ? { ok: true, ranges: [], captures: {}, facts: hit } : empty()

/** Adapt existing algorithms; their thresholds and pattern IDs remain owned by the original modules. */
export function builtinDetectorCallbacks(name) {
  if (name === 'degradation') return {
    initialize: () => null,
    reset: () => null,
    feed: ({ state }) => ({ state, result: empty() }),
    finalize: ({ state, block, params }) => ({ state, result: result(detectDegradation(block.text, params.only)) }),
  }
  const detector = DETECTORS[name]
  if (!detector) throw new Error('builtin-detector-unavailable')
  const initialize = ({ params }) => ({ detector: detector.create(params), view: { ...createView(), counts: [] } })
  const calculate = ({ state, delta, params }, final) => {
    const view = { ...state.view, counts: new Map(state.view.counts) }
    let hit
    if (detector.cadence === 'incremental') hit = detector.feed(state.detector, delta, params)
    else {
      appendText(view, delta)
      if (final || view.bytes >= (params.everyBytes ?? WINDOWED_EVERY)) {
        view.bytes = 0; hit = detector.check(view, state.detector, params)
      }
    }
    return { state: { detector: state.detector, view: { ...view, counts: [...view.counts] } }, result: result(hit) }
  }
  return { initialize, reset: initialize, feed: input => calculate(input, false), finalize: input => calculate(input, true) }
}
const boundedNumber = { type: 'integer', minimum: 1, maximum: 32768 }
const object = properties => ({ type: 'object', properties, additionalProperties: false })
export const builtinDetectorSpecifications = [
  ['marker', object({ token: { type: 'string', minLength: 1, maxLength: 4096 } })],
  ['phrase', object({ phrases: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'string', minLength: 1, maxLength: 4096 } } })],
  ['line-repeat', object({ minLines: boundedNumber, minCount: boundedNumber, minRun: boundedNumber, minRatio: { type: 'number', minimum: 0, maximum: 1 }, everyBytes: boundedNumber })],
  ['degradation', object({ only: { type: 'array', maxItems: PATTERN_IDS.length, items: { type: 'string', enum: PATTERN_IDS } } })],
].map(([builtin, paramsSchema]) => ({ plugin: 'dsh-context-care', ref: `context-care:${builtin}`, revision: 1, builtin,
  on: builtin === 'degradation' ? ['request.assemble', 'output.complete', 'tool.result', 'display.render'] : ['output.delta', 'output.complete', 'display.render', 'request.assemble'],
  paramsSchema: { ...paramsSchema, ...(builtin === 'marker' ? { required: ['token'] } : builtin === 'phrase' ? { required: ['phrases'] } : {}) },
  stateSchema: {}, resultSchema: {}, timeoutMs: 50, maxStateBytes: 262144, maxResultBytes: 65536 }))
