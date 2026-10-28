import { sessionEventShape as shape } from '@leolee9086/dsh-rule-engine'
import type { EventFieldShape } from '@leolee9086/dsh-rule-engine'
import { SESSION_EVENT_PAYLOAD_SHAPES } from './generated/session-events.js'

export function sessionEventShape(eventType: string, custom?: EventFieldShape) {
  return shape(custom ?? Object.entries(SESSION_EVENT_PAYLOAD_SHAPES).find(([name]) => name === eventType)?.[1] ?? 'any')
}
