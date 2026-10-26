const requestFields = ['provider', 'model', 'reasoningEffort', 'temperature', 'maxTokens', 'stop', 'system', 'tools', 'messages'] as const
type PublicPayload = Partial<Record<typeof requestFields[number], unknown>>

/** Capture the complete public JSON estimate, preserving its original field order. */
export function publicRequestBytes(request: object): Buffer {
  const payload = request as PublicPayload
  return Buffer.from(JSON.stringify(Object.fromEntries(requestFields.filter(key => payload[key] !== undefined)
    .map(key => [key, payload[key]]))), 'utf8')
}
