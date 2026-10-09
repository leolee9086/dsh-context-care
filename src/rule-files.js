import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** Explicit declaration paths only: never discover files or import executable modules. */
export async function readRuleFiles(paths, maxBytes = 1048576) {
  return Promise.all(paths.map(async path => {
    if (!isAbsolute(path)) throw new Error(`rule-file-path-must-be-absolute: ${path}`)
    const handle = await open(path, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > maxBytes) throw new Error(`rule-file-invalid-size: ${path}`)
      // A bounded read also covers a file that grows after stat. Do not allocate its new full size.
      const buffer = Buffer.alloc(maxBytes + 1)
      let bytes = 0
      while (bytes < buffer.length) {
        const chunk = await handle.read(buffer, bytes, buffer.length - bytes, null)
        if (!chunk.bytesRead) break
        bytes += chunk.bytesRead
      }
      if (bytes > maxBytes) throw new Error(`rule-file-too-large: ${path}`)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes))
      try { return { path, text, document: JSON.parse(text) } }
      catch (error) { throw new Error(`rule-file-invalid-json: ${path}`, { cause: error }) }
    } finally { await handle.close() }
  }))
}

/** File authors advance revisions explicitly; changing text must not reuse success/cooldown identity. */
export function assertFileRevision(previous, next) {
  if (!previous || previous.id !== next.id || JSON.stringify(previous) === JSON.stringify(next)) return
  if (next.revision <= previous.revision) throw new Error('rule-file-document-needs-new-revision')
  for (const field of ['rules', 'entries', 'partials']) for (const item of next[field]) {
    const old = previous[field].find(value => field === 'partials' ? value.name === item.name : value.id === item.id)
    if (old && (item.revision < old.revision || JSON.stringify(old) !== JSON.stringify(item) && item.revision === old.revision))
      throw new Error(`rule-file-${field}-needs-new-revision`)
  }
}
