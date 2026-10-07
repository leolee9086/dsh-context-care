import { ContextCareStatus, dictionaries } from './client-view.js'
import { REWRITE_NODE, RewriteNodeView, createRewriteDefinition } from './rewrite-view.js'
import { NOTICE_NODE, NoticeNodeView, createNoticeDefinition } from './notice-view.js'
import { ContextCareActions } from './action-view.js'
import { createActionRecords } from './action-records.js'
import { createRewriteRecords } from './rewrite-records.js'

export const inject = ['slots', 'locale', 'uiConversation']

/** Mount status, diagnostics and durable rewrite cards through native slots. */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('dsh-context-care', dictionaries))
  const actions = createActionRecords()
  const rewrites = createRewriteRecords()
  ctx.effect(() => () => { actions.dispose(); rewrites.dispose() })
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'context-care', order: 4, locale: 'dsh-context-care',
    inject: () => ({ hooks: { careActions: actions.source, rewriteHealth: rewrites.health }, watchActions: actions.watch }),
  }, ContextCareStatus))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'context-care-actions', order: 5, locale: 'dsh-context-care',
    inject: () => ({ hooks: { careActions: actions.source }, watchActions: actions.watch }),
  }, ContextCareActions))
  ctx.effect(() => ctx.uiConversation.events.register(createNoticeDefinition()))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: NOTICE_NODE, locale: 'dsh-context-care',
  }, NoticeNodeView))
  ctx.effect(() => ctx.uiConversation.events.register(createRewriteDefinition()))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: REWRITE_NODE, locale: 'dsh-context-care',
    inject: () => ({ hooks: { rewriteRecords: rewrites.records } }),
  }, RewriteNodeView))
}
