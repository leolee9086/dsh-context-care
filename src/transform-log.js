// src/transform-log.js — 变换记录:原本写进会话日志的 log-only 事件。
//
// **已停用(2026-09-23)**。原注释声称这条路"从产生到落盘到加载都没有坑",
// 六处证据逐条看过 —— 但它们全都漏了最要命的一条:**读侧对未知事件类型拒载**。
// 写的时候不拦(append 只做 JSON 校验),可一旦重启,日志里出现这个包未知的类型
// context-care/transform,整个会话直接打不开(ignorable 缺口:Session.append 没有
// 透出 ignorable 的写入口,见 D:/dev/dsh-rule-engine/2026-09-23-外部插件事件落不进日志-ignorable缺口.md)。
//
// 所以现在 record() 只把记录写到插件日志(logger.info),不再写会话日志。
// 变换记录不是模型可见内容,丢了不影响重建 —— 等 C 方案(Session.append 开
// ignorable 写入口)落地,再恢复成会话事件,那时记录才能推给界面。

/** 事件类型名。保留定义,恢复时直接用。 */
export const TRANSFORM_EVENT = 'context-care/transform'

/**
 * 造一个记录器。
 *
 * @param {object} deps
 * @param {object} deps.ctx 插件上下文,用来取 sessions 服务和 logger。
 * @returns {{record: (entry: object) => void}}
 */
export function createTransformLog({ ctx }) {
  /**
   * 记一笔变换(2026-09-23 起只进插件日志,不进会话日志 —— 见文件头注释)。
   *
   * @param {object} entry 记录。
   * @param {string} [entry.sessionId] 属于哪个会话。
   * @param {string} entry.layer 'notice' 或 'request' —— 作用在哪一层。
   * @param {string} entry.ruleId 哪条规则。
   * @param {string} entry.outcome 结果。
   * @param {number} [entry.loss] 废掉多少缓存(0..1)。
   * @param {string} [entry.detail] 说明。
   */
  function record(entry) {
    // 会话日志这条通道先关掉。append 本身不会失败(JSON 校验放行),
    // 但落下去就是一颗雷 —— 重启后读侧拒载。所以这里**不调 append**。
    ctx.logger.info(
      `context-care 变换(仅插件日志): layer=${entry.layer} ruleId=${entry.ruleId} outcome=${entry.outcome}`
      + (entry.loss === undefined ? '' : ` loss=${entry.loss}`)
      + (entry.detail === undefined ? '' : ` detail=${entry.detail}`)
      + (typeof entry.sessionId === 'string' && entry.sessionId !== '' ? ` session=${entry.sessionId}` : '')
    )
  }

  return { record }
}
