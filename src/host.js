import { contextCareProjection } from './projection.js'

export const name = 'dsh-context-care-display'
export const inject = ['sessionProjections']

/** Shared replay projection supports UI reads of idle or archived sessions. */
export function apply(ctx) {
  ctx.effect(() => ctx.sessionProjections.register(contextCareProjection))
}
