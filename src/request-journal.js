import { createHash } from 'node:crypto'
import { createRequestCache } from '../lib/request-cache.js'

/** Hash a JSON-visible request for diagnostics; functions and signals are excluded by callers. */
export function requestFingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

/**
 * Compatibility factory for the request query service. Request facts now come
 * from Session; this factory neither opens nor reads context_care_requests.
 * @param {Parameters<typeof createRequestCache>[0]} options live Session service
 * @returns a disposable request index and in-flight diagnostic cache
 */
export async function openRequestJournal(options) { return createRequestCache(options) }
