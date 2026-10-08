import { ContextCareStatus, dictionaries } from './client-view.js'
import { REWRITE_NODE, RewriteNodeView, createRewriteDefinition } from './rewrite-view.js'
import { NOTICE_NODE, NoticeNodeView, createNoticeDefinition } from './notice-view.js'
import { ContextCareActions, ContextCareActionsOpener } from './action-view.js'
import { createActionRecords } from './action-records.js'
import { createRewriteRecords } from './rewrite-records.js'

export const inject = ['slots', 'locale', 'uiConversation', 'sidebarRightTabs', 'sidebarRight', 'layout']
const ACTIONS_TAB = 'dsh-context-care:actions'

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
  const t = ctx.locale.bind('dsh-context-care')
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: ACTIONS_TAB, kind: ACTIONS_TAB, title: () => t('actionsTitle') }))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: ACTIONS_TAB, locale: 'dsh-context-care',
    inject: () => ({ hooks: { careActions: actions.source }, watchActions: actions.watch, refreshActions: actions.refresh }),
  }, ContextCareActions))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'context-care-actions', order: 5, locale: 'dsh-context-care',
    inject: () => ({ openActions(sessionId) {
      ctx.sidebarRight.openTabIn(sessionId, ACTIONS_TAB)
      if (ctx.sidebarRight.isExpanded() !== true) ctx.layout.openRightbar(false, false)
    } }),
  }, ContextCareActionsOpener))
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
