// Regenerate care's built-in event catalog from a published DSH release.
//
//   pnpm run sync:events                 # newest published rc
//   pnpm run sync:events -- --version 0.2.1-rc.2
//   pnpm run sync:events -- --check      # verify the committed catalog is current
//
// DSH owns event discovery: its generator walks every `SessionEventMap` declaration
// (with ownership, literal-name and JSDoc rules) and emits the persistence schema
// this command consumes. Care therefore never collects from repository code — it
// translates that released artifact into the literal name tuple and the payload
// field shapes a rule's selectors are checked against at load time.
//
// The schema lives under `docs/` and is not part of any npm package, so it is read
// from the release tag through `gh`.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EventFieldShape } from '@leolee9086/dsh-rule-engine'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const careRoot = resolve(here, '..')
const output = resolve(careRoot, 'src/reminder-runtime/generated/session-events.ts')
const SESSION = '@deepseek-ai/dsh-session'
const REPO = 'deepseek-ai/deepseek-harness'
const SCHEMA_PATH = 'docs/persistence-schema.json'
/** Nesting beyond this depth stays `any`: the artifact describes selectors, not every leaf. */
const MAX_DEPTH = 5

/** One canonical schema node, as the released `formatVersion: 2` artifact writes it. */
type CanonicalNode =
  | { kind: 'primitive'; type: string }
  | { kind: 'literal'; value: unknown }
  | { kind: 'opaque' }
  | { kind: 'array'; element: number }
  | { kind: 'tuple'; elements: { type: number }[] }
  | { kind: 'union'; types: number[] }
  | { kind: 'object'; properties: { name: string; optional: boolean; type: number }[]; indices: { value: number }[] }

/** One root of the released artifact; only `kind: 'event'` entries describe log events. */
interface SchemaRoot {
  key: string
  kind: string
  event?: string
  surface?: boolean
  schema: { root: number; nodes: CanonicalNode[] }
}

interface PersistenceSchema { formatVersion: number; roots: readonly SchemaRoot[] }

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const check = args.includes('--check')
const requested = flag('--version')
const tag = (version: string): string => `dsh-v${version}`

const run = (command: string, argv: readonly string[]): string =>
  execFileSync(command, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The newest published release candidate; an explicit version wins. */
function resolveVersion(): string {
  if (requested) return requested
  // Release tags are the published version list, so `gh` stays the single external
  // tool this command needs.
  const raw: unknown = JSON.parse(run('gh', ['api', `repos/${REPO}/tags?per_page=100`]))
  if (!Array.isArray(raw)) throw new Error(`${REPO} returned no tag list`)
  const versions = raw.filter(isRecord).map(entry => entry.name).filter((name): name is string => typeof name === 'string')
    .filter(name => name.startsWith('dsh-v')).map(name => name.slice('dsh-v'.length))
  const newest = versions.filter(version => /-rc\./.test(version)).sort(compareSemver).pop()
  if (!newest) throw new Error(`no release candidate tag found in ${REPO}`)
  return newest
}

/** Semver order over one release line; enough to rank release candidates. */
function compareSemver(left: string, right: string): number {
  const parts = (value: string): (number | string)[] =>
    value.split(/[.-]/).map(part => (/^\d+$/.test(part) ? Number(part) : part))
  const a = parts(left), b = parts(right)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x).localeCompare(String(y))
  }
  return 0
}

/**
 * The released persistence schema for one DSH version. The format version is
 * checked; within `formatVersion: 2` the node shapes are the contract this command
 * was written against, and an unknown node kind degrades to `any` in `shape`.
 */
function fetchSchema(version: string): PersistenceSchema {
  const raw: unknown = JSON.parse(run('gh', ['api', `repos/${REPO}/contents/${SCHEMA_PATH}?ref=${tag(version)}`,
    '-H', 'Accept: application/vnd.github.raw']))
  if (!isRecord(raw) || raw.formatVersion !== 2 || !Array.isArray(raw.roots)) {
    throw new Error(`${tag(version)} carries an unsupported ${SCHEMA_PATH} (formatVersion ${String(isRecord(raw) ? raw.formatVersion : '?')})`)
  }
  return { formatVersion: 2, roots: raw.roots as SchemaRoot[] }
}

/** The installed development copy, used only to cross-check a matching version. */
function installed(): { version: string; dir: string } | undefined {
  try {
    const dir = dirname(require.resolve(`${SESSION}/package.json`))
    const manifest: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    if (!isRecord(manifest) || typeof manifest.version !== 'string') return undefined
    return { version: manifest.version, dir }
  } catch { return undefined }
}

/** Translate one canonical schema node into a selector shape. */
function shape(nodes: readonly CanonicalNode[], id: number, depth = 0): EventFieldShape {
  if (depth >= MAX_DEPTH) return 'any'
  const node = nodes[id]
  if (node === undefined) return 'any'
  switch (node.kind) {
    case 'primitive': case 'literal': return null
    case 'opaque': return 'any'
    case 'array': return { kind: 'array', element: shape(nodes, node.element, depth + 1) }
    case 'tuple': return { kind: 'array', element: union(node.elements.map(entry => shape(nodes, entry.type, depth + 1))) }
    case 'union': return union(node.types.map(type => shape(nodes, type, depth + 1)))
    case 'object': {
      const fields: Record<string, EventFieldShape> = {}
      for (const property of node.properties) fields[property.name] = shape(nodes, property.type, depth + 1)
      const indices = node.indices.map(index => shape(nodes, index.value, depth + 1))
      return { kind: 'object', fields, index: indices.length ? union(indices) : null }
    }
    default: return 'any'
  }
}

/** Collapse options into one shape: any opaque branch wins, duplicates disappear. */
function union(options: readonly EventFieldShape[]): EventFieldShape {
  const flat: EventFieldShape[] = []
  const seen = new Set<string>()
  for (const option of options) {
    const nested = option !== null && typeof option === 'object' && option.kind === 'union' ? option.options : [option]
    for (const entry of nested) {
      if (entry === 'any') return 'any'
      const key = JSON.stringify(entry)
      if (seen.has(key)) continue
      seen.add(key)
      flat.push(entry)
    }
  }
  if (flat.length === 1) return flat[0] as EventFieldShape
  return { kind: 'union', options: flat }
}

/** Event name and the payload shape a selector may walk. */
function translate(schema: PersistenceSchema): Map<string, EventFieldShape> {
  const events = new Map<string, EventFieldShape>()
  for (const root of schema.roots) {
    if (root.kind !== 'event' || typeof root.event !== 'string') continue
    const nodes = root.schema.nodes
    const top = nodes[root.schema.root]
    const data = top !== undefined && top.kind === 'object'
      ? top.properties.find(property => property.name === 'data') : undefined
    events.set(root.event, data === undefined ? 'any' : shape(nodes, data.type))
  }
  if (!events.size) throw new Error('the released schema declares no events')
  return events
}

/** Render one shape as a nested literal so a reviewer can read the structure. */
function renderShape(value: EventFieldShape, indent: number): string {
  if (value === null) return 'null'
  if (value === 'any') return "'any'"
  const prefix = '  '.repeat(indent)
  const inner = '  '.repeat(indent + 1)
  const close = '  '.repeat(Math.max(0, indent - 1))
  if (value.kind === 'array') return `{ kind: 'array', element: ${renderShape(value.element, indent + 1)} }`
  if (value.kind === 'union') {
    const options = value.options.map(option => `${inner}${renderShape(option, indent + 2)},`).join('\n')
    return `{ kind: 'union', options: [\n${options}\n${close}  ] }`
  }
  const entries = Object.entries(value.fields)
  if (!entries.length && value.index === null) return "{ kind: 'object', fields: {}, index: null }"
  const fields = entries.map(([name, field]) =>
    `${inner}${JSON.stringify(name)}: ${renderShape(field, indent + 2)},`).join('\n')
  const index = value.index === null ? 'null' : renderShape(value.index, indent + 2)
  return `{\n${inner}kind: 'object',\n${inner}fields: {\n${fields}\n${inner}},\n${inner}index: ${index},\n${prefix}}`
}

function render(version: string, events: ReadonlyMap<string, EventFieldShape>): string {
  const names = [...events.keys()].sort()
  const lines: string[] = []
  lines.push('// GENERATED by scripts/sync-session-events.ts — do not edit by hand.',
    `// Source of truth: the DSH ${tag(version)} release ${SCHEMA_PATH} (DSH-generated).`,
    '// Run `pnpm run sync:events` after moving to a different DSH release.',
    "import type { EventFieldShape } from '@leolee9086/dsh-rule-engine'",
    '',
    '/** The DSH release this catalog was generated from. */',
    `export const SESSION_EVENT_SOURCE_VERSION = ${JSON.stringify(version)}`,
    '',
    '/** Every built-in event type of that release; the only source of event names. */',
    'export const SESSION_EVENT_TYPES = [')
  for (const name of names) lines.push(`  ${JSON.stringify(name)},`)
  lines.push('] as const', '', '/** One built-in event name known to this release. */',
    'export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number]', '',
    '/** Payload shapes for every event; a rule selector is checked against these. */',
    'export const SESSION_EVENT_PAYLOAD_SHAPES: Record<SessionEventType, EventFieldShape> = {')
  for (const name of names) {
    const value = events.get(name)
    lines.push(`  ${JSON.stringify(name)}: ${renderShape(value === undefined ? 'any' : value, 1)},`)
  }
  lines.push('}', '', '/** Number of built-in event types in this catalog. */',
    `export const SESSION_EVENT_COUNT = ${names.length}`, '')
  return lines.join('\n')
}

const version = resolveVersion()
const events = translate(fetchSchema(version))
const local = installed()
if (local !== undefined && local.version === version) {
  // Two independent DSH artifacts for one release must agree; a mismatch means the
  // translation or the fetch is wrong.
  const module = await import(new URL(`file://${join(local.dir, 'lib/types/known-event-types.js').replaceAll('\\', '/')}`).href)
  const known: unknown = module.KNOWN_SESSION_EVENT_TYPES
  if (!(known instanceof Set)) throw new Error(`${SESSION}@${version} exposes no known event types`)
  const released = [...known].map(String).sort()
  const translated = [...events.keys()].sort()
  const onlySchema = translated.filter(name => !released.includes(name))
  const onlyPackage = released.filter(name => !translated.includes(name))
  if (onlySchema.length || onlyPackage.length) {
    throw new Error(['schema and package vocabularies disagree for ' + version,
      onlySchema.length ? `  only in schema: ${onlySchema.join(', ')}` : '',
      onlyPackage.length ? `  only in package: ${onlyPackage.join(', ')}` : ''].filter(Boolean).join('\n'))
  }
} else if (local !== undefined) {
  console.log(`note: installed ${SESSION}@${local.version} differs from ${version}; cross-check skipped`)
}
const text = render(version, events)

if (check) {
  if (!existsSync(output) || readFileSync(output, 'utf8') !== text) {
    console.error(`event catalog is stale for DSH ${version}; run: pnpm run sync:events`)
    process.exit(1)
  }
  console.log(`event catalog matches DSH ${version} (${events.size} events)`)
} else {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, text)
  console.log(`wrote ${events.size} events for DSH ${version} to ${output}`)
}
