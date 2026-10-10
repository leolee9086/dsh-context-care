import { createServer } from 'node:http'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Exercise ordinary semver package resolution using the actual prepared archives.
// This isolated registry is test infrastructure; it does not establish public npm availability.
const archives = [
  'artifacts/dependency-packages/leolee9086-dsh-rule-engine-0.3.0.tgz',
  'artifacts/dependency-packages/dsh-better-session-query-0.1.1.tgz',
]
const packages = await Promise.all(archives.map(async path => {
  const bytes = await readFile(resolve(path))
  const manifest = spawnSync('tar', ['-xOf', resolve(path), 'package/package.json'], { encoding: 'utf8' })
  if (manifest.status !== 0) throw new Error(manifest.stderr)
  const metadata = JSON.parse(manifest.stdout)
  return { metadata, bytes, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }
}))
let base
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1)
    const entry = packages.find(value => value.metadata.name === path || `${value.metadata.name}/-/${value.metadata.version}.tgz` === path)
    if (entry) {
      if (path.endsWith('.tgz')) { response.setHeader('content-type', 'application/octet-stream'); response.end(entry.bytes); return }
      const { metadata, integrity } = entry
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ name: metadata.name, 'dist-tags': { latest: metadata.version }, versions: { [metadata.version]: { ...metadata,
        dist: { tarball: `${base}/${metadata.name}/-/${metadata.version}.tgz`, integrity } } } }))
      return
    }
    // Read-only proxy, without forwarding credentials or request headers.
    const upstream = await fetch(`https://registry.npmjs.org/${path}`)
    response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
    response.end(Buffer.from(await upstream.arrayBuffer()))
  } catch (error) { response.writeHead(500); response.end(String(error)) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
base = `http://127.0.0.1:${server.address().port}`
console.log('Prepared dependency registry (test-only):', base)
try {
  const candidate = process.argv[2] === '--pack' ? undefined : process.argv[2]
  const args = process.argv[2] === '--pack' ? ['--registry', base, 'pack', '--pack-destination', 'artifacts/candidate']
    : candidate ? ['add', resolve(candidate), '--registry', base] : ['install', '--registry', base]
  const directory = candidate ? await mkdtemp(resolve(tmpdir(), 'care-standard-install-')) : process.cwd()
  if (candidate) {
    await writeFile(resolve(directory, 'package.json'), JSON.stringify({ name: 'care-independent-consumer', private: true, type: 'module' }))
    console.log('Independent consumer:', directory)
  }
  const child = spawn('pnpm', args, { cwd: directory, shell: process.platform === 'win32', stdio: 'inherit' })
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
