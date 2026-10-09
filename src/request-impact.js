const requestFields = ['provider', 'model', 'reasoningEffort', 'temperature', 'maxTokens', 'stop', 'system', 'tools', 'messages']

/** Compare complete public request payloads. Provider wire serialization and cache token hits are unavailable through the LLM service. */
export function requestImpact(before, after) {
  const bytes = request => Buffer.from(JSON.stringify(Object.fromEntries(requestFields.filter(key => request[key] !== undefined).map(key => [key, request[key]]))), 'utf8')
  const original = bytes(before); const transformed = bytes(after)
  let commonPrefixBytes = 0
  while (commonPrefixBytes < Math.min(original.length, transformed.length) && original[commonPrefixBytes] === transformed[commonPrefixBytes]) commonPrefixBytes++
  return { basis: 'public-request-json-estimate', providerSerialization: 'unknown', cacheHitTokens: null,
    beforeBytes: original.length, afterBytes: transformed.length, commonPrefixBytes,
    firstChangedByte: original.equals(transformed) ? null : commonPrefixBytes,
    changedSuffixBytes: Math.max(original.length, transformed.length) - commonPrefixBytes }
}

/** The public meter estimates whole messages, including role framing; it does not expose an exact model tokenizer. */
export function estimateInjection(message, estimateMessage) {
  if (!estimateMessage) return null
  const value = estimateMessage(message)
  if (!Number.isFinite(value) || value < 0) throw new Error('injection-token-estimate-invalid')
  return Math.ceil(value)
}
