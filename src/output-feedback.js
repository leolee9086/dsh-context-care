import { detectOutputPatterns, patternTrigger } from './output-patterns.js'
import { createSessionOutputFeedback } from '../lib/session-output-feedback.js'

/**
 * Output-pattern feedback is a projection of actual Session output and inputs.
 * Existing context_care_output_feedback files are left untouched and unused.
 * @param {Omit<Parameters<typeof createSessionOutputFeedback>[0], 'detect' | 'trigger'>} options native Session service, shared log and source rules
 * @returns disposable feedback episodes and live preparation reservations
 */
export async function openOutputFeedback(options) {
  return createSessionOutputFeedback({ ...options, detect: detectOutputPatterns, trigger: patternTrigger })
}
