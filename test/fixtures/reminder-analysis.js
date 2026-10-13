export async function analyze({ event }) {
  await Promise.resolve()
  return { language: event.arguments.file_path.endsWith('.ts') ? 'ts' : 'other' }
}
export async function judge() { await Promise.resolve(); return { ok: true, facts: { awaited: true } } }
export function loop() { while (true) { /* Verify that cancelling the worker ends non-cooperative CPU work. */ } }
