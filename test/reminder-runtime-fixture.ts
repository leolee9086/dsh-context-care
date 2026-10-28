import type { EventRuntimeOptions as EnvironmentOptions } from '@leolee9086/dsh-rule-engine'
import { createReminderRuntime as createRuntime } from '../lib/reminder-runtime/runtime.js'

export type { ReminderSource } from '../lib/reminder-runtime/runtime.js'
// Tests override only the capability under examination. The resulting production
// constructor still receives all required ports and never supplies its own no-ops.
export type RuntimeOptions = Partial<EnvironmentOptions>
type Arguments = Parameters<typeof createRuntime>

/** A deliberate process-local environment for domain tests, not a replacement Host. */
export function createReminderRuntime(options: RuntimeOptions = {}, engine?: Arguments[1]): ReturnType<typeof createRuntime> {
  const states = new Map<string, Parameters<NonNullable<EnvironmentOptions['save']>>[1]>()
  const capacities: Parameters<NonNullable<EnvironmentOptions['saveCapacity']>>[0][] = []
  const changes: (string | undefined)[] = []
  // Keep diagnostics in the fixture environment; tests that examine reporting
  // supply their own collector, including expected persistence/worker failures.
  const errors: unknown[] = []
  return createRuntime({ ...options,
    save: options.save ?? ((id, state) => { states.set(id, structuredClone(state)) }),
    saveCapacity: options.saveCapacity ?? (value => { capacities.push(structuredClone(value)) }),
    changed: options.changed ?? (id => { changes.push(id) }),
    report: options.report ?? (error => { errors.push(error) }),
    sinceSeq: options.sinceSeq ?? (() => -1),
  }, engine)
}
