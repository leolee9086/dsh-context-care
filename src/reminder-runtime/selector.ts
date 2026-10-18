import { SESSION_EVENT_PAYLOAD_SHAPES, type EventFieldShape } from './generated/session-events.js'

/** Every session event carries these beside its own payload. */
const CLOCK: EventFieldShape = { kind: 'object', fields: { at: null }, index: null }
const ENVELOPE: Record<string, EventFieldShape> = {
  type: null, name: null, callId: null, rootCallId: null, clock: CLOCK,
}

/**
 * The snapshot a matching event is selected from: care's envelope plus the payload
 * shape behind `arguments`. Compiled types are erased at run time, so a rule's
 * selectors are checked against this instead of assumed. The snapshot exposes the
 * triggering event under both `event` and `tool`.
 *
 * A built-in event takes its payload shape from the generated catalog; a declared
 * custom event supplies the shape its descriptor declares.
 */
export function sessionEventShape(eventType: string, custom?: EventFieldShape): EventFieldShape {
  const payload = custom ?? SESSION_EVENT_PAYLOAD_SHAPES[eventType as keyof typeof SESSION_EVENT_PAYLOAD_SHAPES]
  const event: EventFieldShape = { kind: 'object', index: null,
    fields: { ...ENVELOPE, arguments: payload ?? 'any' } }
  return { kind: 'object', index: null, fields: { event, tool: event } }
}

/** Whether the remaining path can be walked from this shape. */
function resolves(shape: EventFieldShape, segments: readonly string[]): boolean {
  if (!segments.length) return true
  if (shape === 'any') return true
  if (shape === null) return false
  const [head, ...rest] = segments
  if (head === undefined) return true
  if (shape.kind === 'array') return /^\d+$/.test(head) && resolves(shape.element, rest)
  if (shape.kind === 'union') return shape.options.some(option => resolves(option, segments))
  const field = shape.fields[head]
  if (field !== undefined) return resolves(field, rest)
  return shape.index !== null && resolves(shape.index, rest)
}

/**
 * Name the first path segment the shape cannot reach, or `undefined` when the
 * whole path resolves. A caller turns the name into a load-time error, which is
 * what stops a misspelled selector from silently never matching.
 */
export function unresolvableSegment(shape: EventFieldShape, path: string): string | undefined {
  let current = shape
  const segments = path.split('.')
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    if (current === 'any') return undefined
    if (current === null) return segment
    if (current.kind === 'array') {
      if (!/^\d+$/.test(segment)) return segment
      current = current.element
      continue
    }
    if (current.kind === 'union') {
      return current.options.some(option => resolves(option, segments.slice(index))) ? undefined : segment
    }
    const field = current.fields[segment]
    if (field !== undefined) { current = field; continue }
    if (current.index !== null) { current = current.index; continue }
    return segment
  }
  return undefined
}

/** Snapshot roots a rule may select from; other roots hold analyzer or context data. */
const ROOTS = ['event', 'tool'] as const

/** Every field path a condition tree reads, in a stable order. */
export function selectorPaths(condition: unknown): string[] {
  const found: string[] = []
  const visit = (node: unknown) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) visit(child); return }
    const record = node as Record<string, unknown>
    const field = record.field
    if (typeof field === 'string' && ROOTS.some(root => field === root || field.startsWith(`${root}.`))) found.push(field)
    const source = record.source
    if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
      const nested = (source as Record<string, unknown>).field
      if (typeof nested === 'string' && ROOTS.some(root => nested === root || nested.startsWith(`${root}.`))) found.push(nested)
    }
    for (const value of Object.values(record)) visit(value)
  }
  visit(condition)
  return found
}
