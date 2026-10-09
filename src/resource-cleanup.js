import { recordSecondaryFailure } from './secondary-failure.js'

/** Release every acquired resource in order, retaining startup's original failure. */
export async function releaseResources(resources, primary) {
  const errors = []
  for (const [phase, release] of resources) {
    try { await release() }
    catch (error) {
      if (primary) recordSecondaryFailure(primary, error, phase)
      else errors.push(error)
    }
  }
  if (!primary && errors.length) throw new AggregateError(errors, 'context-care-resource-close-failed')
}
