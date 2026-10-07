/** Operation-local input prices built solely from injected public services. */

/**
 * Capture one text scale and attachment projection for maintenance or dispatch.
 * @param options - public meter/LLM services, session and effective request header;
 * an own imageRequestPricing field binds dispatch pricing, including its absence.
 * @returns process-local pricing functions; only pricingBasis is serializable.
 */
export function captureInputPricing(options) {
  const { meter, llm, session, header = session.requestHeader() } = options
  const initial = meter.measureInput(session, header)
  const basis = options.requests?.calibration(session, header, initial.pricingBasis) ?? initial.pricingBasis
  const scale = basis.textScale
  const imagePricing = Object.hasOwn(options, 'imageRequestPricing')
    ? options.imageRequestPricing
    : header?.config === undefined ? undefined : llm.imageRequestPricing(header.config.provider, header.config.model)
  const fileText = llm.fileRequestText.bind(llm)
  const fileHandles = new Map()
  const empty = { role: 'user', content: [] }
  // Subtract role framing using the same public estimator; density constants
  // belong to the meter and are deliberately not copied into this plugin.
  const roleTokens = meter.estimateMessage(empty)
  const blockTokens = block => meter.estimateMessage({ ...empty, content: [block] }) - roleTokens
  const schemaTokens = tools => tools?.length
    ? meter.estimateMessage({ role: 'system', content: [{ type: 'text', text: JSON.stringify(tools) }] }) * scale : 0

  function components(messages) {
    const images = imagePricing === undefined ? [] : messages.flatMap(message => message?.content.filter(block => block.type === 'image') ?? [])
    const imagePrices = imagePricing === undefined || images.length === 0 ? [] : imagePricing.priceImages(images)
    if (imagePrices.length !== images.length) throw new Error(`context-care: image pricing answered ${imagePrices.length} prices for ${images.length} occurrences`)
    let cursor = 0
    return messages.map(message => {
      if (message === null) return { textTokens: 0, visualTokens: 0 }
      let text = meter.estimateMessage(message)
      let visual = 0
      for (const block of message.content) {
        if (block.type === 'image' && imagePricing !== undefined) {
          const { offloaded: ignored, ...reference } = block
          const price = imagePrices[cursor++]
          text += blockTokens({ type: 'text', text: price.text }) - blockTokens(reference)
          visual += price.visualTokens
        } else if (block.type === 'file') {
          const key = JSON.stringify(block.attachment)
          if (!fileHandles.has(key)) fileHandles.set(key, fileText(block.attachment))
          text += blockTokens({ type: 'text', text: fileHandles.get(key) }) - blockTokens(block)
        }
      }
      return { textTokens: text, visualTokens: visual }
    })
  }
  function prices(messages) { return components(messages).map(value => value.textTokens * scale + value.visualTokens) }
  function priceMessages(messages) { return prices(messages).reduce((sum, tokens) => sum + tokens, 0) }
  function priceRequest(request) {
    const messages = request.system === undefined ? request.messages
      : [{ role: 'system', content: [{ type: 'text', text: request.system }] }, ...request.messages]
    return priceMessages(messages) + schemaTokens(request.tools)
  }
  function decomposeRequest(request) {
    const messages = request.system === undefined ? request.messages
      : [{ role: 'system', content: [{ type: 'text', text: request.system }] }, ...request.messages]
    const values = components(messages)
    const tools = request.tools?.length ? meter.estimateMessage({ role: 'system', content: [{ type: 'text', text: JSON.stringify(request.tools) }] }) : 0
    return { textTokens: tools + values.reduce((sum, value) => sum + value.textTokens, 0),
      visualTokens: values.reduce((sum, value) => sum + value.visualTokens, 0) }
  }
  function measure() {
    const seqs = [...session.surface.nodes]
    const messages = seqs.map(seq => session.deriveEventMessage(session.eventAt(seq)))
    const tokens = prices(messages)
    const nodes = seqs.map((seq, index) => ({ seq, tokens: tokens[index], heuristicTokens: messages[index] === null ? 0 : meter.estimateMessage(messages[index]) }))
    const surfaceTokens = tokens.reduce((sum, value) => sum + value, 0)
    const toolsTokens = schemaTokens(basis.header?.tools)
    return { logRevision: session.seq, pricingBasis: basis, nodes, surfaceTokens, toolsTokens, inputTokens: surfaceTokens + toolsTokens }
  }
  // Prewarm file handles before any maintenance replaces the selected input.
  prices(session.deriveMessages())
  return Object.freeze({ pricingBasis: basis, initial, priceMessages, priceRequest, decomposeRequest, measure })
}
