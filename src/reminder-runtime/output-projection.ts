import { createOutputProjection as createProjection } from '@leolee9086/dsh-rule-engine'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
export function createOutputProjection(...args: Parameters<typeof createProjection>) {
  const projection = createProjection(...args)
  return { ...projection, get deadline() { return projection.deadline },
    push(at: number, chunk: StreamChunk) {
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'block-start' || chunk.type === 'block-end') return projection.push(at, chunk)
      return projection.advance(at)
    },
  }
}
