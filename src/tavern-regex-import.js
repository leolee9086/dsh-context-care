import { z } from 'zod'
import { validateDocument } from './workbench-store.js'

const Script = z.object({ id: z.string().min(1).max(256).optional(), scriptName: z.string().max(4096).optional(),
  findRegex: z.string().min(1).max(4096), replaceString: z.string().max(16384), trimStrings: z.array(z.string()).default([]),
  placement: z.array(z.number().int()).min(1), disabled: z.boolean().default(false), markdownOnly: z.boolean().default(false),
  promptOnly: z.boolean().default(false), runOnEdit: z.boolean().default(false), substituteRegex: z.number().int().default(0),
  minDepth: z.number().int().nullable().optional(), maxDepth: z.number().int().nullable().optional(), }).passthrough()
const fields = new Set(Object.keys(Script.shape))

/** Pure versioned conversion. Source macros/JS are never executed; unsupported scripts are omitted with reports. */
export function importTavernRegex(input, templates) {
  const single = input?.findRegex !== undefined
  const rawScripts = Array.isArray(input) ? input : single ? [input] : input.regexScripts
  if (!Array.isArray(rawScripts) || rawScripts.length > 256) throw new Error('invalid-tavern-regex-list')
  const base = { schemaVersion: 2, id: input.id ?? 'imported-tavern-regex', revision: 1, title: input.name ?? 'Imported Tavern regex' }
  validateDocument({ ...base, rules: [] }, templates)
  const report = []; const rules = []; const ids = new Set()
  if (!Array.isArray(input) && !single) for (const key of Object.keys(input)) if (!['id', 'name', 'regexScripts'].includes(key)) report.push({ path: key, status: 'unsupported', message: 'Top-level field was not imported.' })
  rawScripts.forEach((raw, index) => {
    const path = `regexScripts.${index}`
    const note = (field, status, message) => report.push({ path: field ? `${path}.${field}` : path, status, message })
    const reject = (field, message) => { note(field, 'rejected', message); note('', 'rejected', 'Script omitted; other scripts are retained.') }
    if (raw && typeof raw === 'object') for (const field of Object.keys(raw)) if (!fields.has(field)) note(field, 'unsupported', 'Field was not imported.')
    const parsed = Script.safeParse(raw)
    if (!parsed.success) { for (const issue of parsed.error.issues) note(issue.path.join('.'), 'rejected', issue.message); reject('', 'Invalid script.'); return }
    const row = parsed.data
    if (row.substituteRegex !== 0 || row.findRegex.includes('{{')) { reject('substituteRegex', 'Source pattern macros are not executed.'); return }
    if (row.trimStrings.length) { reject('trimStrings', 'Capture trimming has no equivalent native template operation.'); return }
    if (row.placement.some(value => ![1, 2, 6].includes(value))) { reject('placement', 'Only user input, assistant output and reasoning placements are supported.'); return }
    if (!row.markdownOnly && !row.promptOnly) { reject('markdownOnly', 'Source-history mutation has no native equivalent; choose a display or prompt copy explicitly.'); return }
    if (row.minDepth != null && row.minDepth > 0 || row.maxDepth != null && row.maxDepth >= 0) { reject('minDepth', 'Source depth includes minimum offsets; no equivalent selector was applied.'); return }
    const literal = /^\/([\s\S]*)\/([a-z]*)$/.exec(row.findRegex)
    const pattern = literal ? literal[1] : row.findRegex; const flags = literal ? literal[2] : ''
    if (/[^gimsu]/.test(flags) || new Set(flags).size !== flags.length) { reject('findRegex', 'Only g/i/m/s/u flags are supported.'); return }
    try { new RegExp(pattern, flags) } catch (error) { reject('findRegex', error.message); return }
    // Preserve literal source braces. Only documented capture substitutions become native bindings.
    if (/{{(?!match}})/i.test(row.replaceString)) { reject('replaceString', 'Source replacement macros are not executed.'); return }
    const replacement = row.replaceString.replace(/{{match}}/gi, '$0').replace(/\$(\d+)|\$<([^>]+)>/g, (_match, number, name) => `{{captures.[${number ?? name}]}}`)
    const id = row.id ?? `regex-${index}`
    if (ids.has(id)) { reject('id', 'Duplicate script ID.'); return }
    const stages = [...(row.markdownOnly ? ['display.render'] : []), ...(row.promptOnly ? ['request.assemble'] : [])]
    // Separate selectors prevent the reasoning placement from also selecting ordinary assistant text.
    const selectors = [...(row.placement.includes(1) ? [{ roles: ['user'], blockTypes: ['text'] }] : []),
      ...(row.placement.includes(2) ? [{ roles: ['assistant'], blockTypes: ['text'] }] : []),
      ...(row.placement.includes(6) ? [{ roles: ['assistant'], blockTypes: ['reasoning'] }] : [])]
    const candidates = stages.flatMap(stage => selectors.map((select, part) => ({ schemaVersion: 2, id: `${id}:${stage}:${part}`, revision: 1, title: row.scriptName ?? id,
      on: [stage], select: { ...select, view: stage === 'display.render' ? 'display' : 'model' },
      match: { kind: 'regex', pattern, flags: flags.replace('g', ''), all: flags.includes('g') },
      actions: [{ id: 'replace', kind: 'replace', stage, enabledDefault: !row.disabled, template: replacement }] })))
    try { validateDocument({ ...base, rules: candidates }, templates) } catch (error) { reject('', error.message); return }
    ids.add(id); rules.push(...candidates)
    for (const field of Object.keys(raw).filter(field => fields.has(field))) {
      const difference = ['placement', 'runOnEdit', 'markdownOnly', 'promptOnly'].includes(field)
      note(field, difference ? 'difference' : 'converted', difference
        ? 'Mapped to immutable display/request copies. Native blocks and baseline patch ordering differ from source edit and sequential replacement semantics.'
        : 'Mapped to the native regex declaration.')
    }
    note('', 'difference', 'Imported as baseline copy patches, not sequential source-history edits; signed/opaque blocks retain native protection.')
  })
  return { document: validateDocument({ ...base, rules }, templates), report, importer: { format: 'tavern-regex', version: 1 } }
}
