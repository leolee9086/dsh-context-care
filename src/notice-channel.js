import { createNoticeChannel } from '@leolee9086/dsh-rule-engine'

export const NOTICE_CHANNEL = 'contextNotices'

// 两个原生入口共享一个服务实例；来源注册、控制时效、去重与冷却均由库拥有。
let shared
export function sharedNoticeChannel(options) {
  if (shared === undefined) shared = createNoticeChannel(options)
  return shared
}
