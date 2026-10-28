// Fixtures use the public engine declaration directly. Every caller supplies the
// action and event fields it exercises; no retired reminder format is accepted.
/**
 * @param {string} stage
 * @param {Partial<import('@leolee9086/dsh-rule-engine').RuleDeclaration>} fields
 * @param {Partial<import('@leolee9086/dsh-rule-engine').ActionDeclaration>} action
 * @returns {import('@leolee9086/dsh-rule-engine').RuleDeclaration & { actions: (import('@leolee9086/dsh-rule-engine').ActionDeclaration & { template: string })[] }}
 */
export function eventRule(stage, { id = 'notice', ...fields } = {}, { template = 'NOTICE', delivery = { model: { once: 'surface' } }, ...action } = {}) {
  return { schemaVersion: 2, sourceId: 'test', revision: 1, id, on: [stage],
    select: { view: 'original', roles: ['tool', 'assistant', 'user'], blockTypes: ['tool-result', 'tool-call', 'text', 'reasoning'] },
    match: { kind: 'always' }, ...fields,
    actions: [{ id: 'model', kind: 'notify', stage, enabledDefault: true, template, delivery, ...action }],
  }
}
