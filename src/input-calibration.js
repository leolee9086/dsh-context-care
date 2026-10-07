import { requestFingerprint } from './request-journal.js'

/** Adapter-default metadata does not change the complete input's configuration identity. */
export function calibrationHeaderKey(header) {
  return requestFingerprint({ config: header?.config, tools: header?.tools })
}

/** Calibrate from the complete actual projection, including one-shot text and unscaled visual prices. */
export function journalCalibration(records, header, fallback) {
  const requests = records.filter(record => record.kind === 'request')
  if (requests.length === 0) return fallback
  const key = calibrationHeaderKey(header)
  const eligible = requests.filter(({ data }) => data.dispatched && data.outcome === 'completed'
    && data.purpose === 'conversation' && data.calibrationHeaderKey === key && data.rawInput?.textTokens > 0
    && data.usage?.inputTokens !== undefined && data.eventType === 'assistant/message')
    .sort((a, b) => b.data.eventSeq - a.data.eventSeq)
  for (const { data } of eligible) {
    const prompt = data.usage.inputTokens + (data.usage.cacheReadTokens ?? 0) + (data.usage.cacheWriteTokens ?? 0)
    if (prompt < data.rawInput.textTokens + data.rawInput.visualTokens) continue
    return Object.freeze({ ...fallback, kind: 'usage-calibrated', textScale: (prompt - data.rawInput.visualTokens) / data.rawInput.textTokens,
      sampleSeq: data.eventSeq, header, source: 'actual-request-journal', sampleCallId: data.callId })
  }
  // Once actual requests are available, a proposal-only meter anchor cannot
  // silently substitute for a matching successful terminal projection.
  return Object.freeze({ ...fallback, kind: 'uncalibrated-estimate', textScale: 1, sampleSeq: undefined, header, source: 'actual-request-journal' })
}
