import { createCompletionOutbox, COMPLETION_NOTICES_DOMAIN } from '@leolee9086/dsh-rule-engine'
import { completionNoticeText } from './completion-copy.js'


/** 旧独立调用方的原生表端口；生产 Session 路径不打开这些侧表。 */
export async function openCompletionNotices(storageDomain) {
  const handle = await storageDomain.open(COMPLETION_NOTICES_DOMAIN)
  const outbox = createCompletionOutbox({ table: handle.table('notices'), processed: handle.table('processed'), render: completionNoticeText })
  return { ...outbox, close: () => handle.close() }
}
