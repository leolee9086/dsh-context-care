import type { Context } from '@deepseek-ai/cordis'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pbkdf2 } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { REMINDER_DOMAIN, SessionState } from '../../src/reminder-runtime/state.ts'
import { CLAIM_DOMAIN } from '../../src/reminder-runtime/claims.ts'

type StorageService = Context['storage']
type Backend = Parameters<StorageService['backend']['register']>[1]

/** Import only from the explicitly selected external test Host, never a production dependency. */
async function hostModule(relative: string): Promise<Record<string, unknown>> {
  const checkout = process.env.DSH_TEST_CHECKOUT
  if (!checkout) throw new Error('real persistence tests require DSH_TEST_CHECKOUT and its tsx source loader')
  const loaded: unknown = await import(pathToFileURL(resolve(checkout, relative)).href)
  if (loaded === null || typeof loaded !== 'object') throw new Error(`invalid Host module: ${relative}`)
  return loaded as Record<string, unknown>
}

/** Open the actual JSON storage domain implementation over an owned temporary directory. */
export async function openRealReminderStorage(existingRoot?: string) {
  const [cordisModule, storageModule, jsonModule, domainModule] = await Promise.all([
    hostModule('vendor/cordis/src/index.ts'),
    hostModule('packages/storage/storage/src/index.ts'),
    hostModule('packages/storage/storage-json/src/index.ts'),
    hostModule('packages/storage/storage-domain/src/index.ts'),
  ])
  const contextExport = cordisModule.Context
  const storageExport = storageModule.default
  const jsonExport = jsonModule.JsonStorageBackend
  const domainExport = domainModule.DomainFacility
  if (typeof contextExport !== 'function' || typeof storageExport !== 'function'
    || typeof jsonExport !== 'function' || typeof domainExport !== 'function') {
    throw new Error('selected Host is missing its real storage constructors')
  }
  // These are constructor signatures of the loaded Host exports. No service method is replaced.
  const ContextConstructor = contextExport as typeof Context
  const StorageConstructor = storageExport as new (ctx: Context) => StorageService
  const JsonConstructor = jsonExport as new (root: string) => Backend
  const DomainConstructor = domainExport as typeof DomainFacility
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'care-persistence-real-'))
  const ctx = new ContextConstructor()
  await ctx.plugin(StorageConstructor)
  const backend = new JsonConstructor(root)
  const unregister = ctx.storage.backend.register('json', backend)
  const facility = new DomainConstructor(ctx, { backend: 'json' })
  const domain = await facility.open(REMINDER_DOMAIN)
  const claimDomain = await facility.open(CLAIM_DOMAIN)
  const sessions = domain.table('sessions')
  const claims = claimDomain.table('claims')
  if (!claims.get('global')) await claims.put('global', { buckets: [] })
  let closed = false
  const recordPath = (sessionId: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error('fixture requires path-safe session id')
    return join(root, REMINDER_DOMAIN.name, 'sessions', `${sessionId}.json`)
  }
  return {
    root, ctx, facility, domain, claimDomain, sessions, claims,
    recordPath,
    /** Read the actual disk envelope, independently of the domain's memory. */
    async readDisk(sessionId: string) {
      const parsed: unknown = JSON.parse(await readFile(recordPath(sessionId), 'utf8'))
      return z.object({ version: z.literal(1), record: SessionState }).parse(parsed).record
    },
    /** Release all real domain writes before freeing their context. Keep files for restart assertions. */
    async close() {
      if (closed) return
      closed = true
      await facility.closeAll()
      unregister()
      await backend.close()
      await ctx.fiber.dispose()
    },
  }
}

/**
 * Occupy the destination with a nonempty directory. The real atomic writer still writes/fsyncs
 * its temp file, but the OS refuses rename over the directory. Restore retains the original bytes.
 */
export async function obstructRecord(path: string) {
  await mkdir(dirname(path), { recursive: true })
  const held = `${path}.fixture-held`
  let hadRecord = true
  try { await rename(path, held) }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    hadRecord = false
  }
  await mkdir(path)
  await writeFile(join(path, 'obstruction'), 'owned by real persistence test\n')
  let restored = false
  return async () => {
    if (restored) return
    restored = true
    await rm(path, { recursive: true })
    if (hadRecord) await rename(held, path)
  }
}

/**
 * Occupy the sole real libuv worker with CPU work; following fs calls must queue behind it.
 * This is resource contention, not a fake filesystem or a claim about physical disk latency.
 * Callers assert the work is still active at each observation rather than assuming machine speed.
 */
export function occupyIoWorker(iterations = 2_000_000) {
  if (process.env.UV_THREADPOOL_SIZE !== '1') throw new Error('pressure case requires UV_THREADPOOL_SIZE=1 before process start')
  const began = performance.now()
  let settledAt: number | undefined
  const done = new Promise<void>((resolveDone, reject) => {
    pbkdf2('persistence-test-input', 'persistence-test-salt', iterations, 32, 'sha512', error => {
      settledAt = performance.now()
      if (error) reject(error)
      else resolveDone()
    })
  })
  return {
    done,
    active: () => settledAt === undefined,
    elapsed: () => (settledAt ?? performance.now()) - began,
  }
}
