import { parentPort } from 'node:worker_threads'
import { detectRulesV2 } from './vendor/rule-engine/index.js'
import { createWorkerDetectors } from './detector-worker.js'
parentPort.on('message', input => {
  try {
    if (!input.detectorSpecifications) parentPort.postMessage({ result: detectRulesV2(input) })
    else {
      const detectors = createWorkerDetectors(input.detectorSpecifications, input.detectorStates)
      if (input.detectorReset) { detectors.reset(input.detectorReset); parentPort.postMessage({ result: { events: [], states: {} } }) }
      else parentPort.postMessage({ result: { events: detectRulesV2({ ...input, detectorMatch: detectors.match }), states: detectors.updated } })
    }
  }
  catch (error) { parentPort.postMessage({ error: { name: error.name, message: error.message } }) }
})
parentPort.postMessage({ ready: true })
