// src/transform-log.js — 变换记录:写进会话日志的 log-only 事件。
//
// 为什么是这个做法:从「产生」到「落盘」到「加载」整条路都查过了,没有坑。
// 六处独立证据(都在 deepseek-harness\packages\core\session\src\):
//
//   产生 —— append 时的数据校验(index.ts 调 surface.ts 的 validateSessionEventData):
//     只校验 request/header 和 tool/result,其它类型一律放过。data 只要 JSON 可序列化。
//   产生 —— 事件关系的合法性(invariant.ts):
//     第 69-70 行「Context and plugin-owned log-only events may be appended between
//     model executions」;第 161-162 行的 default 分支
//     「Merge-extensible event relations belong to their owning plugin」——
//     不要求 turn 内,也不强加关系。所以请求层异步 append 也不违规。
//   落盘 —— 只是写进 append-only 的 JSONL,类型就是字符串。
//   加载 —— seed 校验的 switch(index.ts 229-238)**没有 default**,
//     只对 request/header、system/message、user/message、assistant/attempt、
//     assistant/message、tool/result 六个类型做额外检查,别的直接跳过。
//   回放 —— surface 判定是四个类型的白名单(surface.ts 50-63),
//     不在里面就不是 surface 事件;投影成 null(surface.ts 153-157,以及 deriveEventMessage
//     的注释「a non-surface event (attempt, boundary, log-only record)」)。
//   版本 —— types.ts 81-82「Adding an ordinary event type does not bump — the per-event
//     ignorable guard covers vocabulary growth instead」,不用升 SESSION_FORMAT_VERSION。
//
// 现成的先例一抓一把,全是「package-owned log-only event」:plan-mode 的 plan/mode、
// tool-workflow 的四个包内事件、workspace-changes 的 workspace/changes、
// session-title 的 session/title、compaction/*。
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
