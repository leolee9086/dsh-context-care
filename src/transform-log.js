// src/transform-log.js — 变换记录:写进会话日志的 log-only 事件。
//
// 为什么是这个做法(查证过 DSH 的实现,不是猜的):
//   · core/session/src/surface.ts 第 153-157 行:
//     「A non-surface event (boundary, attempt, log-only record) projects to no message.
//      Merge-extensible union: no assertNever here.」
//     —— 非 surface 事件投影成「没有消息」,模型看不到它。
//   · core/session/src/types.ts 第 81-82 行:
//     「Adding an ordinary event type does not bump — the per-event ignorable guard
//      covers vocabulary growth instead.」
//     —— 加一个普通事件类型不触发格式版本升级,词汇增长由 ignorable 兜。
//   · validateSessionEventData 只校验 request/header 和 tool/result,其它类型一律放过。
//   · 现成的先例一抓一把:plan-mode 的 plan/mode、tool-workflow 的四个包内事件、
//     workspace-changes 的 workspace/changes、session-title 的 session/title,
//     全是「package-owned log-only event」。
//
// 这么写的好处:记录自动获得「持久、可回放、能通过 session.follow 推给界面」。
// 不用自己发明一套轮询,也不用把状态藏在进程内存里 ——
// 搜索进度那条路是进程内 + 轮询,那是因为它是高频瞬时的、不该进日志;
// 变换记录不是,它是要有据可查的。

/** 事件类型名。带包名前缀,跟 workspace/changes、session/title 一个风格。 */
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
   * 记一笔变换。
   *
   * 拿不到会话、或者 append 失败时只留一条 warn —— 记录不该毁掉这次请求
   * (tool-workflow 的 append 也是这么处理的:「disabled durable record after ... append failed」)。
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
    const sessionId = entry.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') {
      ctx.logger.warn(`context-care: 变换记录 ${entry.ruleId} 拿不到会话,只留在日志里`)
      return
    }
    const session = ctx.get('sessions')?.get(sessionId)
    if (session === undefined) {
      ctx.logger.warn(`context-care: 变换记录 ${entry.ruleId} 找不到会话 ${sessionId},只留在日志里`)
      return
    }
    try {
      session.append(TRANSFORM_EVENT, {
        at: Date.now(),
        layer: entry.layer,
        ruleId: entry.ruleId,
        outcome: entry.outcome,
        loss: entry.loss ?? 0,
        ...(entry.detail === undefined ? {} : { detail: entry.detail }),
      })
    } catch (error) {
      ctx.logger.warn(`context-care: 变换记录 ${entry.ruleId} 写不进会话日志: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { record }
}
