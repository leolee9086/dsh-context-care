/**
 * 本插件在 V4 会话里的消息源归属。
 *
 * V4 起消息源由生产者拥有：退役的 `{ kind: 'plugin', plugin }` 包装会被会话准入直接拒绝
 * （`format v4 message requires a producer-owned source kind`，见
 * `packages/session/session-format-v3-to-v4/src/message-sources.ts`），
 * 于是任何往会话里追加消息的插件都必须给出自己的 kind。
 *
 * 已发布的 V3 历史由 `dsh-session-format-v3-to-v4` 迁移改写，迁移表（`src/sources.ts`）之外
 * 的生产者一律变成 `plugin:<原名>` 并丢掉 `plugin` 字段。这里发出的 kind 与迁移结果逐字相同，
 * 所以读取侧只有一套判据：新旧消息、迁移前后的事件都认得出。
 */

/** 迁移表给未知生产者加的前缀。 */
const PRODUCER_PREFIX = 'plugin:'

/** 交接消息（surface checkpoint）的当前 kind；V3 里的 `compact` 迁移后就是它。 */
export const CHECKPOINT_KIND = 'compact-checkpoint'

/** 发出用：把生产者名写成 V4 的 kind。 */
export function producerKind(producer) {
  return `${PRODUCER_PREFIX}${producer}`
}

/** 读取用：从未迁移的 V3 事件或已迁移/原生 V4 事件里取回生产者名。 */
export function producerOf(source) {
  if (source === null || typeof source !== 'object') return undefined
  if (typeof source.plugin === 'string' && source.plugin.length > 0) return source.plugin
  const kind = source.kind
  return typeof kind === 'string' && kind.startsWith(PRODUCER_PREFIX)
    ? kind.slice(PRODUCER_PREFIX.length)
    : undefined
}

/** 这条消息是否由某个生产者发出。 */
export function producedBy(source, producer) {
  return producerOf(source) === producer
}

/** 这条消息是否属于某生产者家族，例如 `dsh-context-care:` 下的全部子生产者。 */
export function producedUnder(source, prefix) {
  const producer = producerOf(source)
  return producer !== undefined && producer.startsWith(prefix)
}

/** 这条消息是否是 surface 上的交接标记（本插件清空历史时写的、或 DSH 压缩写的）。 */
export function isCheckpointSource(source) {
  if (source === null || typeof source !== 'object') return false
  return source.kind === CHECKPOINT_KIND || producedBy(source, 'compact')
}
