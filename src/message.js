import { randomUUID } from 'node:crypto'

/** Build plugin-owned data for the injected Agent inbox; no Host implementation is loaded. */
export function createUserMessage({ content, source }) {
  // Optional trace fields must be omitted before the inbox reaches Session's strict JSON validator.
  // Detach the captured evidence as well, so later detector/config mutations cannot rewrite history.
  return { id: randomUUID(), role: 'user', content, source: JSON.parse(JSON.stringify(source)) }
}
