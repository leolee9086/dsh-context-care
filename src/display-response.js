/** Validate identities and text before publishing a detail snapshot to React. */
export function parseDisplayResponse(body, { seq }) {
  const invalid = () => { throw new Error('Invalid display response') }
  if (!body || !Array.isArray(body.projections) || body.projections.length > 1 || !Number.isSafeInteger(seq)) invalid()
  const blocks = input => {
    if (!Array.isArray(input)) invalid()
    const ids = new Set()
    return input.map(block => {
      if (!block || typeof block.id !== 'string' || !block.id || ids.has(block.id)
        || typeof block.role !== 'string' || !block.role || typeof block.type !== 'string' || !block.type
        || block.text !== undefined && typeof block.text !== 'string'
        || block.path !== undefined && typeof block.path !== 'string'
        || block.seq !== undefined && block.seq !== seq) invalid()
      ids.add(block.id)
      return { id: block.id, role: block.role, type: block.type, text: block.text, path: block.path, seq: block.seq }
    })
  }
  return { projections: body.projections.map(projection => {
    if (!projection || projection.seq !== seq) invalid()
    return { seq, before: blocks(projection.before), after: blocks(projection.after) }
  }) }
}
