/**
 * 作用位置与规则作用域。
 */

/**
 * 规则能作用的位置。
 *
 * 对应酒馆的 regex_placement，但换成 DSH 上下文里真实存在的位置：
 * 酒馆的 MD_DISPLAY / SLASH_COMMAND / WORLD_INFO 在 DSH 里没有对应物；
 * 而 DSH 的工具调用与工具结果是两个独立位置，酒馆没有。
 *
 * 用字符串而不是数字：规则要能手写、能序列化、日志里要能直接读。
 */
export const PLACEMENT = Object.freeze({
  /** 用户输入。 */
  USER: 'user',
  /** 助手输出。 */
  ASSISTANT: 'assistant',
  /** 思考内容。 */
  REASONING: 'reasoning',
  /** 工具调用（工具名与参数）。 */
  TOOL_CALL: 'tool-call',
  /** 工具结果。 */
  TOOL_RESULT: 'tool-result',
  /**
   * 组装好的整段请求体。只有请求层看得见它 ——
   * 消息之外还有系统提示词、工具定义等等,那些在 pre-step 里改不到。
   * 所以这个位置只对提供 requestRewrite 服务的插件有意义。
   */
  REQUEST: 'request',
})

/** 全部合法位置。 */
export const PLACEMENTS = Object.freeze(Object.values(PLACEMENT))

/**
 * 规则作用域。
 *
 * 数值同时定义优先级 —— 照搬酒馆 SCRIPT_TYPES 上的那句注释
 * （ORDER MATTERS: defines the regex script priority）：数值小的先跑。
 */
export const SCOPE = Object.freeze({
  /** 全局规则。 */
  GLOBAL: 0,
  /** 挂在某个角色/会话上的规则。 */
  SCOPED: 1,
  /** 挂在某个预设上的规则。 */
  PRESET: 2,
})

/** 全部合法作用域。 */
export const SCOPES = Object.freeze(Object.values(SCOPE))
