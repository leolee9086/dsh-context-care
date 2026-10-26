import type { TestContext } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { createSessionLog } from '../../lib/session-log.js'

/** Compose the actual services. Tests create/append real Sessions themselves;
 * this helper never interprets events or implements a log read method. */
export function nativeSession(t: TestContext) {
  const ctx = new Context()
  const sessions = new SessionStore(ctx), logs = createSessionLog(ctx)
  t.after(async () => { logs.close(); await ctx.fiber.dispose() })
  return { ctx, sessions, logs }
}
