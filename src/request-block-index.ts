/** Fields used to locate immutable request blocks during one planning operation. */
export interface RequestBlock {
  id: string
  view: string
  callId?: string
  messageIndex: number
  path: string
}

/** Build lookup groups once without copying block payloads or changing source order. */
export function indexRequestBlocks<B extends RequestBlock>(blocks: readonly B[]) {
  const model: B[] = [], byId = new Map<string, B>(), byCall = new Map<string, B[]>()
  for (const block of blocks) {
    if (block.view === 'model') { model.push(block); byId.set(block.id, block) }
    const callId = block.callId
    if (callId) {
      let group = byCall.get(callId)
      if (!group) { group = []; byCall.set(callId, group) }
      group.push(block)
    }
  }
  return { model, byId, byCall }
}

/** Preserve the existing stable rightmost-first order without rebuilding ICU
 * collation options for every path comparison. Keep the collator local: each
 * sort observes the current default locale and retains no request data. */
export function orderRequestRemovals<B extends RequestBlock>(blocks: readonly B[], filters: ReadonlySet<string>): B[] {
  let compare: Intl.Collator['compare'] | undefined
  return blocks.filter(block => filters.has(block.id)).sort((a, b) => b.messageIndex - a.messageIndex
    || (compare ??= new Intl.Collator(undefined, { numeric: true }).compare)(b.path, a.path))
}

/** A removed ancestor already covers its descendants; synthetic results are not parents. */
export function filteredAncestor(block: RequestBlock, removed: ReadonlySet<string>): boolean {
  let end = block.path.lastIndexOf('.')
  while (end >= 0) {
    if (removed.has(JSON.stringify([block.messageIndex, block.path.slice(0, end)]))) return true
    end = block.path.lastIndexOf('.', end - 1)
  }
  return false
}
