import { detectRulesV2 } from '@leolee9086/dsh-rule-engine'
import { createWorkerDetectors } from './detector-worker.js'
import { runWorker } from '../lib/matcher/worker.js'

// Preserve the existing JS detector engine boundary. The shared worker protocol,
// reminder execution and cancellation checkpoints live in the typed runner.
runWorker(payload => {
  if (!payload.detectorSpecifications) return detectRulesV2(payload)
  const detectors = createWorkerDetectors(payload.detectorSpecifications, payload.detectorStates)
  if (payload.detectorReset) {
    detectors.reset(payload.detectorReset)
    return { events: [], states: {} }
  }
  return { events: detectRulesV2({ ...payload, detectorMatch: detectors.match }), states: detectors.updated }
})
