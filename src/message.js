import { randomUUID } from 'node:crypto'

/** Build plugin-owned data for the injected Agent inbox; no Host implementation is loaded. */
export function createUserMessage({ content, source }) {
  return { id: randomUUID(), role: 'user', content, source }
}
