import { z } from 'zod'
import { validateDocument } from './workbench-store.js'
import { importTavernRegex } from './tavern-regex-import.js'

const WorldEntry = z.object({
  uid: z.union([z.string().min(1).max(256), z.number().int().nonnegative()]).optional(),
  comment: z.string().max(4096).optional(), content: z.string().max(16384).optional(),
  constant: z.boolean().optional(), disable: z.boolean().optional(), selective: z.boolean().optional(),
  key: z.array(z.string().min(1).max(4096)).max(256).optional(), keysecondary: z.array(z.string().min(1).max(4096)).max(256).optional(),
  selectiveLogic: z.number().int().min(0).max(3).optional(), order: z.number().int().min(-100000).max(100000).optional(),
  position: z.number().int().optional(), depth: z.number().int().nonnegative().optional(),
  caseSensitive: z.boolean().optional(), matchWholeWords: z.boolean().optional(), scanDepth: z.number().int().min(1).max(10000).optional(),
  sticky: z.number().int().nonnegative().max(10000).optional(), cooldown: z.number().int().nonnegative().optional(), excludeRecursion: z.boolean().optional(),
}).passthrough()
const mapped = new Set(Object.keys(WorldEntry.shape))

/** Import native documents or the supported world-info fields; every untranslated field receives a report. */
export function importWorkbench(input, templates) {
  if (input?.schemaVersion === 2) return { document: validateDocument(input, templates), report: [] }
  if (Array.isArray(input) || input?.regexScripts || input?.findRegex !== undefined) return importTavernRegex(input, templates)
  if (!input || typeof input !== 'object' || Array.isArray(input) || !input.entries || typeof input.entries !== 'object') throw new Error('unsupported-import-format')
  const report = []; const entries = []; const ids = new Set()
  const base = { schemaVersion: 2, id: input.id ?? 'imported-world-info', revision: 1, title: input.name ?? 'Imported world info' }
  // Invalid document metadata fails the import; individual invalid entries get their own rejection report.
  validateDocument({ ...base, entries: [] }, templates)
  for (const field of Object.keys(input)) if (!['id', 'name', 'entries'].includes(field)) report.push({ path: field, status: 'unsupported', message: 'Top-level field was not imported.' })
  for (const [key, raw] of Object.entries(input.entries)) {
    const path = `entries.${key}`
    const rejected = (field, message) => report.push({ path: field ? `${path}.${field}` : path, status: 'rejected', message })
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const field of Object.keys(raw))
      if (!mapped.has(field)) report.push({ path: `${path}.${field}`, status: 'unsupported', message: 'Field was not imported.' })
    const parsed = WorldEntry.safeParse(raw)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) rejected(issue.path.join('.'), issue.message)
      rejected('', 'Invalid entry omitted; other entries are retained.'); continue
    }
    const row = parsed.data
    const positions = { 0: { role: 'system', anchor: 'start' }, 1: { role: 'system', anchor: 'end' } }
    const target = positions[row.position ?? 1]
    if (!target) { rejected('position', 'Position has no equivalent supported request anchor; entry omitted.'); continue }
    // Tavern macros are not Handlebars. Import must never reinterpret source code as native executable templates.
    if (row.content?.includes('{{')) { rejected('content', 'Source macros are not executed. Convert this content to a native template before importing; entry omitted.'); continue }
    const secondary = !row.constant && row.selective && row.keysecondary?.length
      ? { values: row.keysecondary, mode: ['ANY', 'NOT-ALL', 'NOT-ANY', 'ALL'][row.selectiveLogic ?? 0] } : undefined
    const candidate = { id: String(row.uid ?? key), revision: 1, title: row.comment ?? String(row.uid ?? key), enabledDefault: row.disable !== true, template: row.content ?? '',
      activation: row.constant ? { kind: 'constant' } : { kind: 'keywords', keywords: row.key ?? [],
        caseSensitive: row.caseSensitive ?? false, wordBoundary: row.matchWholeWords ?? false, ...(secondary ? { secondary } : {}) },
      select: { view: 'model', roles: ['user', 'assistant', 'tool'], blockTypes: ['text'], depth: { unit: 'message', limit: row.scanDepth ?? 100 } },
      target: { view: 'model', position: 'after', ...target }, priority: row.order ?? 0,
      stickyTurns: row.sticky ?? 0, cooldownMs: 0, cascade: row.excludeRecursion === false }
    try {
      if (ids.has(candidate.id)) throw new Error('Duplicate entry ID; first accepted entry is retained.')
      if (entries.length >= 256) throw new Error('Entry limit exceeded (256).')
      const entry = validateDocument({ ...base, entries: [candidate] }, templates).entries[0]
      entries.push(entry); ids.add(entry.id)
    } catch (error) { rejected('', `${error.message}; entry omitted.`); continue }
    for (const field of Object.keys(row).filter(field => mapped.has(field))) {
      let status = 'converted'; let message = 'Mapped to the native entry.'
      if (field === 'cooldown' && row.cooldown !== 0) { status = 'unsupported'; message = 'Source cooldown counts turns; no millisecond cooldown was applied.' }
      else if (field === 'depth') { status = 'unsupported'; message = 'Depth is unused at the selected system start/end anchor.' }
      else if (field === 'scanDepth') { status = 'difference'; message = 'Native depth counts messages, including tool results; source scan window semantics may differ.' }
      else if (field === 'sticky') { status = 'difference'; message = 'Mapped to native sticky turns; review against the source turn boundaries.' }
      else if (field === 'excludeRecursion') { status = 'difference'; message = 'Mapped to bounded native entry cascade, with visited identities preventing cycles.' }
      else if (row.constant && ['key', 'keysecondary', 'selective', 'selectiveLogic', 'caseSensitive', 'matchWholeWords'].includes(field)
        || ['keysecondary', 'selectiveLogic'].includes(field) && !secondary) { status = 'difference'; message = 'Inactive keyword field was not applied to activation.' }
      report.push({ path: `${path}.${field}`, status, message })
    }
    report.push({ path, status: 'converted', message: 'Imported entry with the field differences listed above.' })
  }
  return { document: validateDocument({ ...base, entries }, templates), report, importer: { format: 'tavern-world-info', version: 1 } }
}
