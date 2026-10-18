import { z } from 'zod'

/**
 * Zod v4 stores `message` as an own accessor, not a data property. Structured
 * clone copies an Error by its own data properties, so a `ZodError` that crosses
 * such a boundary arrives with an empty message; `worker_threads`/`postMessage`
 * and the test runner's cross-process error relay both clone this way.
 *
 * Converting at parse boundaries keeps a rejection diagnosable after it crosses
 * one, and the original error stays available as `cause`.
 */
export function schemaError(error: unknown, what: string): Error {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const detail = error.issues.map(issue => {
    const path = issue.path.length ? issue.path.join('.') : '(root)'
    return `${path}: ${issue.message}`
  }).join('; ')
  return new Error(`${what}: ${detail}`, { cause: error })
}

/** Run one schema parse, reporting a rejection as an error that survives relay. */
export function parseOrThrow<T>(what: string, parse: () => T): T {
  try { return parse() }
  catch (error) { throw schemaError(error, what) }
}
