import { ContextCareStatus, dictionaries } from './client-view.js'
import { REWRITE_NODE, RewriteNodeView, createRewriteDefinition } from './rewrite-view.js'
import { NOTICE_NODE, NoticeNodeView, createNoticeDefinition } from './notice-view.js'
import { ContextCareActions, ContextCareActionsOpener } from './action-view.js'
import { createActionRecords } from './action-records.js'
import { createDisplayRecords } from './display-records.js'
import { createRewriteRecords } from './rewrite-records.js'
import { ContextCarePrompts } from './prompt-view.js'
import { createControlRecords } from './control-records.js'
import { ContextCareControls, ContextCareControlsOpener } from './control-view.js'

import { sourceNavigation } from './source-navigation.js'
import { DISPLAY_NODE, DisplayNodeView, createDisplayDefinition } from './display-view.js'

export const inject = ['slots', 'locale', 'uiConversation', 'sessions', 'sidebarRightTabs', 'sidebarRight', 'layout']
const ACTIONS_TAB = 'dsh-context-care:actions'
const PROMPTS_TAB = 'dsh-context-care:prompts'
const CONTROLS_TAB = 'dsh-context-care:rules'

/** Mount status, diagnostics and durable rewrite cards through native slots. */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('dsh-context-care', dictionaries))
  const revealFor = sourceNavigation(ctx)
  const controls = createControlRecords()
  const actions = createActionRecords()
  const rewrites = createRewriteRecords()
  const prompts = createActionRecords({ endpoint: '/context-care/prompts', collection: 'prompts' })
  const display = createDisplayRecords()
  let selection = new Map()
  const selectionListeners = new Set()
  const promptSelection = { getSnapshot: () => selection, subscribe(listener) { selectionListeners.add(listener); return () => selectionListeners.delete(listener) } }
  function openPrompts(sessionId, seq) {
    selection = new Map(selection).set(sessionId, { seq })
    for (const listener of selectionListeners) listener()
    ctx.sidebarRight.openTabIn(sessionId, PROMPTS_TAB)
    if (ctx.sidebarRight.isExpanded() !== true) ctx.layout.openRightbar(false, false)
  }
  ctx.effect(() => () => { controls.dispose(); actions.dispose(); rewrites.dispose(); prompts.dispose(); display.dispose(); selectionListeners.clear(); selection.clear() })
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'context-care', order: 4, locale: 'dsh-context-care',
    inject: () => ({ hooks: { careActions: actions.source, rewriteHealth: rewrites.health }, watchActions: actions.watch, watchRewrites: rewrites.watch }),
  }, ContextCareStatus))
  const t = ctx.locale.bind('dsh-context-care')
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: CONTROLS_TAB, kind: CONTROLS_TAB, title: () => t('controlsTitle') }))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: CONTROLS_TAB, locale: 'dsh-context-care',
    inject: () => ({ hooks: { careControls: controls.source }, watchControls: controls.watch, changeControls: controls.change, refreshControls: controls.refresh }),
  }, ContextCareControls))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'context-care-controls', order: 6, locale: 'dsh-context-care',
    inject: () => ({ openControls(sessionId) {
      ctx.sidebarRight.openTabIn(sessionId, CONTROLS_TAB)
      if (ctx.sidebarRight.isExpanded() !== true) ctx.layout.openRightbar(false, false)
    } }),
  }, ContextCareControlsOpener))
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: ACTIONS_TAB, kind: ACTIONS_TAB, title: () => t('actionsTitle') }))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: ACTIONS_TAB, locale: 'dsh-context-care',
    inject: sessionId => ({ hooks: { careActions: actions.source }, watchActions: actions.watch, refreshActions: actions.refresh, revealSource: revealFor(sessionId) }),
  }, ContextCareActions))
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: PROMPTS_TAB, kind: PROMPTS_TAB, title: () => t('promptsTitle') }))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PROMPTS_TAB, locale: 'dsh-context-care',
    inject: sessionId => ({ hooks: { carePrompts: prompts.source, carePromptSelection: promptSelection }, watchPrompts: prompts.watch, refreshPrompts: prompts.refresh, revealSource: revealFor(sessionId) }),
  }, ContextCarePrompts))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'context-care-actions', order: 5, locale: 'dsh-context-care',
    inject: () => ({ openPrompts, openActions(sessionId) {
      ctx.sidebarRight.openTabIn(sessionId, ACTIONS_TAB)
      if (ctx.sidebarRight.isExpanded() !== true) ctx.layout.openRightbar(false, false)
    } }),
  }, ContextCareActionsOpener))
  ctx.effect(() => ctx.uiConversation.events.register(createDisplayDefinition()))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: DISPLAY_NODE, locale: 'dsh-context-care',
    inject: () => ({ hooks: { displayRecords: display.source }, watchDisplay: display.watch }),
  }, DisplayNodeView))
  ctx.effect(() => ctx.uiConversation.events.register(createNoticeDefinition()))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: NOTICE_NODE, locale: 'dsh-context-care',
    inject: () => ({ openPrompts }),
  }, NoticeNodeView))
  ctx.effect(() => ctx.uiConversation.events.register(createRewriteDefinition()))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: REWRITE_NODE, locale: 'dsh-context-care',
    inject: () => ({ hooks: { rewriteRecords: rewrites.records }, watchRewrites: rewrites.watch }),
  }, RewriteNodeView))
}
