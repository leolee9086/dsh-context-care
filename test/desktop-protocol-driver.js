import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { basename, dirname, resolve } from 'node:path'

/** Launch a read-only copy of the deployed Electron with a test-owned app/profile. */
export async function createDesktopProtocolDriver(root) {
  for (const name of ['DSH_TEST_DESKTOP_EXE', 'DSH_TEST_DESKTOP_MAIN']) assert.ok(process.env[name], `${name} required`)
  assert.ok(process.env.DSH_TEST_DESKTOP_MAIN.replaceAll('\\', '/').includes('/app.asar/'), 'Select the actual deployed desktop main inside ASAR')
  const source = dirname(process.env.DSH_TEST_DESKTOP_EXE)
  const target = resolve(root, 'electron')
  const application = resolve(target, 'resources', 'app')
  const profile = resolve(root, 'electron-profile')
  await mkdir(application, { recursive: true })
  await mkdir(profile, { recursive: true })
  // Copy engine files only: the production ASAR, profile and configuration stay outside this app.
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isFile() && (/\.(dll|pak|bin|dat)$/i.test(entry.name) || entry.name === basename(process.env.DSH_TEST_DESKTOP_EXE))) {
      await copyFile(resolve(source, entry.name), resolve(target, entry.name))
    }
  }
  await cp(resolve(source, 'locales'), resolve(target, 'locales'), { recursive: true })
  await copyFile(new URL('./fixtures/desktop-protocol.cjs', import.meta.url), resolve(application, 'main.cjs'))
  await writeFile(resolve(application, 'package.json'), JSON.stringify({ name: 'care-isolated-protocol-test', version: '1.0.0', main: 'main.cjs' }))
  const messages = []
  let waiting
  let channel
  let stderr = ''
  const receive = message => {
    if (waiting) { const pending = waiting; waiting = undefined; clearTimeout(pending.timer); pending.resolve(message) }
    else messages.push(message)
  }
  const server = createServer(socket => {
    if (channel) { socket.destroy(); return }
    channel = socket
    createInterface({ input: socket }).on('line', line => receive(JSON.parse(line)))
    socket.on('error', error => receive({ kind: 'fatal', error: { message: error.message } }))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const env = { ...process.env, DSH_TEST_DESKTOP_USER_DATA: profile, DSH_TEST_IPC_PORT: String(server.address().port) }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(resolve(target, basename(process.env.DSH_TEST_DESKTOP_EXE)), ['--no-first-run'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let exited = false
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000) })
  child.stdout.on('data', chunk => { stderr = (stderr + chunk).slice(-12000) })
  child.once('error', error => receive({ kind: 'fatal', error: { message: error.message } }))
  const closed = new Promise(resolve => child.once('close', code => {
    exited = true
    receive({ kind: 'fatal', error: { message: `Electron exited ${code}: ${stderr}` } })
    resolve(code)
  }))
  const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting = undefined; reject(new Error(`Electron reply timeout: ${stderr}`)) }, 30000)
    waiting = { resolve, reject, timer }
  })
  const close = async () => {
    if (!exited) {
      channel?.write(JSON.stringify({ kind: 'close' }) + '\n')
      const timer = setTimeout(() => child.kill(), 3000)
      try { await closed } finally { clearTimeout(timer) }
    }
    channel?.destroy()
    await new Promise(resolve => server.close(resolve))
  }
  try {
    const ready = await next()
    assert.equal(ready.kind, 'ready', JSON.stringify(ready))
    assert.equal(ready.versions.electron, '44.0.0')
    return {
      versions: ready.versions,
      async run(options) {
        channel.write(JSON.stringify({ kind: 'run', ...options }) + '\n')
        const result = await next()
        assert.equal(result.kind, 'result', JSON.stringify(result))
        assert.equal(result.error, undefined, JSON.stringify(result))
        return result
      },
      close,
    }
  } catch (error) { await close(); throw error }
}
