import { fromMarkdown } from 'mdast-util-from-markdown'
import { z } from 'zod'

const positive = z.number().int().positive()
const condition = z.object({ minStatements: z.number().int().nonnegative(), minHits: z.number().int().nonnegative(),
  minHitStatements: z.number().int().nonnegative(), minDensity: z.number().min(0).max(1),
  minFamilyStatements: z.number().int().nonnegative() }).strict()

/** Deployment supplies vocabulary, thresholds and all retained-evidence bounds. */
export const OutputPatternConfig = z.object({
  detectorVersion: z.string().min(1), locale: z.string().min(1), maxTextChars: positive,
  maxStatements: positive, maxEvidence: positive, maxPhrases: positive, maxPhraseChars: positive,
  phrases: z.array(z.object({ id: z.string().min(1), family: z.string().min(1), literal: z.string().min(2) }).strict()).min(1),
  metaPrefixes: z.array(z.string().min(1)),
  thresholds: z.array(condition).min(1), windowOutputs: positive,
  window: z.object({ minOutputs: positive, minHitsPerOutput: positive, minHits: positive,
    minFamilyOutputs: positive, minDensity: z.number().min(0).max(1) }).strict(),
  cooldownCompletedOutputs: z.number().int().nonnegative(), rearmHealthyOutputs: positive, maxDeliveries: positive,
}).strict().superRefine((value, ctx) => {
  if (value.phrases.length > value.maxPhrases) ctx.addIssue({ code: 'custom', message: 'phrases exceed maxPhrases' })
  const ids = new Set()
  for (const phrase of value.phrases) {
    if (ids.has(phrase.id)) ctx.addIssue({ code: 'custom', message: `duplicate phrase ${phrase.id}` })
    ids.add(phrase.id)
    if (phrase.literal.length > value.maxPhraseChars) ctx.addIssue({ code: 'custom', message: 'literal exceeds maxPhraseChars' })
  }
  if (value.window.minOutputs > value.windowOutputs || value.window.minFamilyOutputs > value.windowOutputs) {
    ctx.addIssue({ code: 'custom', message: 'window conditions exceed windowOutputs' })
  }
  try { new Intl.Segmenter(value.locale) } catch (error) { ctx.addIssue({ code: 'custom', message: String(error) }) }
})

/** Structured prose with source offsets; code, HTML and block quotes never become statements. */
export function markdownStatements(text, locale = 'zh') {
  const tree = fromMarkdown(text)
  const statements = []
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })
  function visit(node) {
    if (['blockquote', 'code', 'html'].includes(node.type)) return
    if (node.type === 'paragraph' || node.type === 'heading') {
      const start = node.position.start.offset
      const end = node.position.end.offset
      const chars = [...text.slice(start, end)].join('').split('')
      function redact(child) {
        if (['inlineCode', 'html', 'image'].includes(child.type)) {
          chars.fill(' ', child.position.start.offset - start, child.position.end.offset - start)
        } else for (const part of child.children ?? []) redact(part)
      }
      redact(node)
      const prose = chars.join('')
      // A soft line break is a statement boundary, including Markdown list rows.
      let lineStart = 0
      for (const line of prose.split('\n')) {
        for (const part of segmenter.segment(line)) {
          const trimmed = part.segment.trim()
          if (!/[\p{L}\p{N}]/u.test(trimmed)) continue
          const offset = start + lineStart + part.index
          statements.push({ text: part.segment, start: offset, end: offset + part.segment.length })
        }
        lineStart += line.length + 1
      }
      return
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return statements
}

/** Enumerate literal hits on complete statements, merging overlap before counting. */
export function detectOutputPatterns(text, config) {
  if (text.length > config.maxTextChars) return { status: 'unavailable', reason: 'maxTextChars', length: text.length }
  const statements = markdownStatements(text, config.locale)
  if (statements.length > config.maxStatements) return { status: 'unavailable', reason: 'maxStatements', count: statements.length }
  const evidence = []
  const exclusions = []
  const families = new Map()
  let N = 0, K = 0, H = 0, words = 0
  const wordSegmenter = new Intl.Segmenter(config.locale, { granularity: 'word' })
  for (const statement of statements) {
    const prefix = config.metaPrefixes.find(value => statement.text.trimStart().startsWith(value))
    if (prefix !== undefined) {
      if (exclusions.length < config.maxEvidence) exclusions.push({ start: statement.start, end: statement.end, reason: 'meta-prefix', prefix })
      continue
    }
    const statementId = N++
    words += [...wordSegmenter.segment(statement.text)].filter(part => part.isWordLike).length
    const candidates = []
    for (const phrase of config.phrases) {
      let at = statement.text.indexOf(phrase.literal)
      while (at !== -1) {
        candidates.push({ phraseId: phrase.id, family: phrase.family, start: statement.start + at,
          end: statement.start + at + phrase.literal.length, text: phrase.literal })
        at = statement.text.indexOf(phrase.literal, at + phrase.literal.length)
      }
    }
    const hits = []
    for (const hit of candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)) {
      if (!hits.some(old => old.start < hit.end && hit.start < old.end)) hits.push(hit)
    }
    if (hits.length > 0) K++
    H += hits.length
    for (const hit of hits) {
      if (!families.has(hit.family)) families.set(hit.family, new Set())
      families.get(hit.family).add(statementId)
      if (evidence.length < config.maxEvidence) evidence.push(hit)
    }
  }
  const familyStatements = Object.fromEntries([...families].map(([family, ids]) => [family, ids.size]))
  return { status: 'measured', detectorVersion: config.detectorVersion, locale: config.locale,
    N, K, H, F: families.size, J: Math.max(0, ...Object.values(familyStatements)), D: N === 0 ? null : K / N,
    words, R: words === 0 ? null : 100 * H / words, familyStatements, evidence, exclusions }
}

/** Single-output rules are OR; the bounded window requires repeated same-family evidence. */
export function patternTrigger(sample, window, config) {
  if (sample.status !== 'measured') return undefined
  if (config.thresholds.some(rule => sample.N >= rule.minStatements && sample.H >= rule.minHits
    && sample.K >= rule.minHitStatements && sample.D !== null && sample.D >= rule.minDensity && sample.J >= rule.minFamilyStatements)) return 'single-output'
  const measured = window.filter(value => value.status === 'measured')
  const N = measured.reduce((sum, value) => sum + value.N, 0)
  const K = measured.reduce((sum, value) => sum + value.K, 0)
  const H = measured.reduce((sum, value) => sum + value.H, 0)
  const familyOutputs = new Map()
  for (const value of measured) for (const family of Object.keys(value.familyStatements)) familyOutputs.set(family, (familyOutputs.get(family) ?? 0) + 1)
  const rule = config.window
  if (sample.K > 0 && measured.filter(value => value.K >= rule.minHitsPerOutput).length >= rule.minOutputs && H >= rule.minHits
    && Math.max(0, ...familyOutputs.values()) >= rule.minFamilyOutputs && N > 0 && K / N >= rule.minDensity) return 'window'
  return undefined
}
