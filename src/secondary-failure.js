/** Keep the primary error and expose a failed repair, audit or transaction close. */
export function recordSecondaryFailure(primary, secondary, phase) {
  const detail = { phase, code: secondary?.code, message: secondary instanceof Error ? secondary.message : String(secondary) }
  if (primary instanceof Error) {
    primary.secondaryFailures = [...(primary.secondaryFailures ?? []), detail]
  }
  // Caller still receives the provider's original code/message. The independent
  // failure is also reported with its stack instead of disappearing in a catch.
  console.error(`context-care: ${phase} failed while handling the primary error`, secondary)
  return detail
}
