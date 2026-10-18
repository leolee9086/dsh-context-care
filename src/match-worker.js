import { parentPort } from 'node:worker_threads'
import { detectRulesV2 } from '@leolee9086/dsh-rule-engine'
import { executeReminderMatch } from '../lib/reminder-runtime/matcher.js'
import { assertDetectorJson } from './detector-protocol.js'
import { createWorkerDetectors } from './detector-worker.js'
parentPort.on('message', async input => {
  parentPort.postMessage({ started: true })
  try {
    if (input.warmup) { parentPort.postMessage({ result: null }) }
    else if (input.analysis) {
      const { analyzer, event, maxBytes } = input.analysis
      const module = await import(analyzer.module)
      if (typeof module[analyzer.exportName] !== 'function') throw new Error('reminder-analyzer-export-missing')
      const facts = await module[analyzer.exportName]({ event, context: event.context ?? { messages: [], truncated: false } })
      assertDetectorJson(facts)
      if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) throw new Error('reminder-analysis-requires-facts-object')
      if (Buffer.byteLength(JSON.stringify(facts)) > maxBytes) throw new Error('reminder-analysis-budget-exceeded')
      parentPort.postMessage({ result: facts })
    }
    else if (input.reminder) {
      parentPort.postMessage({ result: await executeReminderMatch(input.reminder) })
    }
    else if (!input.detectorSpecifications) parentPort.postMessage({ result: detectRulesV2(input) })
    else {
      const detectors = createWorkerDetectors(input.detectorSpecifications, input.detectorStates)
      if (input.detectorReset) { detectors.reset(input.detectorReset); parentPort.postMessage({ result: { events: [], states: {} } }) }
      else parentPort.postMessage({ result: { events: detectRulesV2({ ...input, detectorMatch: detectors.match }), states: detectors.updated } })
    }
  }
  catch (error) { parentPort.postMessage({ error: { name: error.name, message: error.message } }) }
})
parentPort.postMessage({ ready: true })
