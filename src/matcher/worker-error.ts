export interface WorkerError {
  name: string
  message: string
}

/**
 * Exceptions cross a MessagePort too. A judge can throw an Error whose runtime
 * fields violate Error's TS declaration, so only checked strings enter replies.
 * Keep each caller's existing non-Error message convention via messageOf.
 */
export function serializeWorkerError(error: unknown, messageOf: (error: unknown) => unknown): WorkerError {
  try {
    const name: unknown = error instanceof Error ? error.name : 'Error'
    const message: unknown = messageOf(error)
    if (typeof name !== 'string' || typeof message !== 'string') {
      return { name: 'TypeError', message: 'matcher-error-serialization-failed: non-string error name or message' }
    }
    return { name, message }
  } catch {
    // An accessor or String conversion can itself throw. Report that failure
    // explicitly; never leave the Host waiting for an unsent exception object.
    return { name: 'TypeError', message: 'matcher-error-serialization-failed: unreadable error fields' }
  }
}
