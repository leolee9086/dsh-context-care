import { parentPort } from 'node:worker_threads'
import { detectRulesV2 } from '@leolee9086/dsh-rule-engine'
import { createWorkerDetectors } from './detector-worker.js'
parentPort.on('message', input => {
  parentPort.postMessage({ started: true })
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
