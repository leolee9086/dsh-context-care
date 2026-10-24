import { createClientChanges } from '../../lib/client-changes.js'
import { CareSubscription, careSubscriptionKey } from '../../lib/care-stream.js'

export const turn = () => new Promise(resolve => setImmediate(resolve))

/** A real streaming Response; only the external network producer is controlled by the test. */
export function careStreamFixture() {
  const opened = []; const errors = []
  const fetcher = async (url, { signal }) => {
    let producer
    const body = new ReadableStream({ start(controller) { producer = controller } })
    const encoder = new TextEncoder()
    const subscriptions = new URL(url, 'http://localhost').searchParams.getAll('subscription').map(value => CareSubscription.parse(JSON.parse(value)))
    const revisions = new Map()
    signal.addEventListener('abort', () => producer.error(signal.reason), { once: true })
    opened.push({ url, signal, subscriptions,
      send: text => producer.enqueue(encoder.encode(text)), end: () => producer.close(),
      frame(query, value, type = 'snapshot') {
        const normalized = CareSubscription.parse(query), key = careSubscriptionKey(normalized)
        if (!subscriptions.some(item => careSubscriptionKey(item) === key)) throw new Error(`No subscription: ${key}`)
        const revision = (revisions.get(key) ?? 0) + 1; revisions.set(key, revision)
        return { key, sessionId: normalized.sessionId, topic: normalized.topic, revision, type,
          ...(type === 'error' ? { error: value } : { value }) }
      },
    })
    return new Response(body)
  }
  const changes = createClientChanges({ fetcher, report: error => errors.push(error) })
  const push = (query, value, type = 'snapshot') => {
    const stream = opened.at(-1)
    stream.send(JSON.stringify(stream.frame(query, value, type)) + '\n')
  }
  return { changes, opened, errors, push }
}
