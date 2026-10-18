import { fromMarkdown } from 'mdast-util-from-markdown'

/** Source ranges use UTF-16 offsets, matching JS strings and mdast positions. */
export interface TextSpan {
  text: string
  start: number
  end: number
}

// Only the parser fields used by this traversal cross the projection boundary.
interface MarkdownNode {
  type: string
  position?: { start: { offset?: number }; end: { offset?: number } }
  children?: readonly MarkdownNode[]
}

/** Soft line breaks and locale sentence boundaries split the same source span. */
export function textStatements(text: string, locale: string, start = 0): TextSpan[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })
  const statements: TextSpan[] = []
  let lineStart = 0
  for (const line of text.split('\n')) {
    for (const part of segmenter.segment(line)) {
      if (!/[\p{L}\p{N}]/u.test(part.segment)) continue
      const offset = start + lineStart + part.index
      statements.push({ text: part.segment, start: offset, end: offset + part.segment.length })
    }
    lineStart += line.length + 1
  }
  return statements
}

/** Code, HTML, quotes and images are excluded without shifting source offsets. */
function markdownProjection(text: string, locale: string) {
  const statements: TextSpan[] = []
  const exclusions: { start: number; end: number }[] = []
  function bounds(node: MarkdownNode) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    // fromMarkdown supplies positions. Missing positions must not fabricate evidence.
    if (start === undefined || end === undefined) throw new TypeError('markdown-source-position-missing')
    return { start, end }
  }
  function visit(node: MarkdownNode): void {
    if (['blockquote', 'code', 'html'].includes(node.type)) return
    if (node.type === 'paragraph' || node.type === 'heading') {
      const { start, end } = bounds(node)
      const chars = text.slice(start, end).split('')
      function redact(child: MarkdownNode): void {
        if (['inlineCode', 'html', 'image'].includes(child.type)) {
          const excluded = bounds(child)
          exclusions.push(excluded)
          chars.fill(' ', excluded.start - start, excluded.end - start)
        } else {
          for (const part of child.children ?? []) redact(part)
        }
      }
      redact(node)
      statements.push(...textStatements(chars.join(''), locale, start))
      return
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(fromMarkdown(text))
  return { statements, exclusions }
}

export function markdownStatements(text: string, locale = 'zh'): TextSpan[] {
  return markdownProjection(text, locale).statements
}

/** Numerator and denominator consume this one projection; offsets stay original. */
export function projectText(text: string, projection: 'raw' | 'markdown-prose', locale: string, metaPrefixes: readonly string[]) {
  const parsed = projection === 'raw' ? { statements: textStatements(text, locale), exclusions: [] } : markdownProjection(text, locale)
  const statements = parsed.statements.filter(span => !metaPrefixes.some(prefix => span.text.trimStart().startsWith(prefix)))
  const included = new Uint8Array(text.length)
  if (projection === 'raw' && metaPrefixes.length === 0) return { text, statements, included: included.fill(1) }
  // Retain line boundaries while masking excluded regions with same-width blanks.
  const chars: string[] = text.split('').map(char => char === '\n' || char === '\r' ? char : ' ')
  for (const span of statements) {
    included.fill(1, span.start, span.end)
    for (const [index, char] of span.text.split('').entries()) chars[span.start + index] = char
  }
  for (const excluded of parsed.exclusions) included.fill(0, excluded.start, excluded.end)
  return { text: chars.join(''), statements, included }
}
