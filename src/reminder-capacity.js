import { z } from 'zod'

// Zero is an explicit unlimited catalog. Execution time, queue and message budgets are separate.
export const RuleLimit = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const CapacitySettings = z.object({ revision: z.number().int().nonnegative(), maxRules: RuleLimit }).strict()
export const CapacityWire = CapacitySettings.extend({
  registeredRules: z.number().int().nonnegative(),
  rejections: z.array(z.object({ sourceId: z.string(), sourceRules: z.number().int().nonnegative(),
    totalRules: z.number().int().nonnegative(), limit: RuleLimit, message: z.string() }).strict()),
}).strict()
export class CapacityError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
