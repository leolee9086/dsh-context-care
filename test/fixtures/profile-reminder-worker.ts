import { Session } from 'node:inspector/promises'
import { writeFile } from 'node:fs/promises'
import { isMainThread, threadId } from 'node:worker_threads'
import { z } from 'zod'

interface Recording { session: Session; path: string }
// This state lives only inside the profiled real worker and only for one recording.
let recording: Recording | undefined
const Input = z.object({ event: z.object({ arguments: z.object({ path: z.string().min(1) }) }) })

/** Invoked as an actual analyzer to attach the profiler to this same Worker. */
export async function start(raw: unknown) {
  if (isMainThread) throw new Error('profile must run inside the production worker')
  if (recording) throw new Error('worker profile already active')
  const { path } = Input.parse(raw).event.arguments
  const session = new Session()
  session.connect()
  try {
    await session.post('Profiler.enable')
    await session.post('Profiler.setSamplingInterval', { interval: 1000 })
    await session.post('Profiler.start')
    recording = { session, path }
    return { threadId, path }
  } catch (error) { session.disconnect(); throw error }
}

/** Keep the large CPU trace on disk; only checked metadata crosses the port. */
export async function stop() {
  const current = recording
  if (!current) throw new Error('worker profile not active')
  recording = undefined
  try {
    const { profile } = await current.session.post('Profiler.stop')
    await writeFile(current.path, JSON.stringify(profile) + '\n', { encoding: 'utf8', flag: 'wx' })
    return { threadId, path: current.path, samples: profile.samples?.length ?? 0 }
  } finally { current.session.disconnect() }
}
