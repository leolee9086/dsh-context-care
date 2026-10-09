// Check every shipped source file, including worker and display entry points.
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = readdirSync(resolve(root, 'src'), { recursive: true }).filter(name => name.endsWith('.js')).sort()
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, 'src', file)], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
}
if (!process.exitCode) console.log(`Syntax checked ${files.length} source files.`)
