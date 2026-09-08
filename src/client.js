import { ContextCareStatus, dictionaries } from './client-view.js'

export const inject = ['slots', 'locale']

/** Add two context indicators beneath the composer, without replacing its built-in statistics. */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('dsh-context-care', dictionaries))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'context-care', order: 4, locale: 'dsh-context-care',
  }, ContextCareStatus))
}
