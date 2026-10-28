import { COMPLETION_STATE_DOMAIN } from '@leolee9086/dsh-rule-engine'



/**
 * 旧独立调用方的原生存储端口。ready/save 保留后端实际 ACK，状态转换全部在库。
 * 生产完成提醒依旧只读 Session 事实，不打开这个旧持久域。
 */
export function createCompletionStateStore({ storageDomain } = {}) {
  if (storageDomain === undefined) throw new Error('completion state requires storageDomain')
  let observations
  const opening = Promise.resolve().then(() => storageDomain.open(COMPLETION_STATE_DOMAIN)).then(handle => {
    observations = handle.table('observations')
    return handle
  })
  return {
    ready: opening,
    load: key => observations === undefined ? opening.then(() => observations.get(key)) : observations.get(key),
    save: (key, value) => observations === undefined ? opening.then(() => observations.put(key, value)) : observations.put(key, value),
    close: async () => (await opening).close(),
  }
}
