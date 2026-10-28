

/** 原生请求呈现；静态/切换触发、路由选择和模板插值全部由库决定。 */
export function withScopedPrompts(request, segments) {
  if (segments.length === 0) return request
  return { ...request, messages: [...request.messages, {
    role: 'user', content: [{ type: 'text', text: segments.map(segment => segment.text).join('\n\n') }],
    source: { kind: 'plugin:dsh-context-care:scoped-prompts' },
  }] }
}
