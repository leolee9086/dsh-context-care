/** Resources used by actual writes must outlive an observation timeout. */
export interface ReminderShutdown {
  close(): Promise<void>
  drainPersistence(): Promise<void>
}

/**
 * Runtime close is bounded and reports unknown I/O. Host disposal must additionally
 * keep its storage domains alive until the real writes and compensation stop.
 * Uncancellable I/O can therefore delay Host disposal; we do not claim hard cancellation.
 */
export async function shutdownReminderRuntime(runtime: ReminderShutdown): Promise<void> {
  let failure: unknown
  try { await runtime.close() }
  catch (error) { failure = error }
  try { await runtime.drainPersistence() }
  catch (error) {
    throw failure === undefined ? error : new AggregateError([failure, error], 'reminder-shutdown-failed')
  }
  if (failure !== undefined) {
    // Finish local cleanup after a recovered drain, but retain the original timeout report.
    await runtime.close()
    throw failure
  }
}
