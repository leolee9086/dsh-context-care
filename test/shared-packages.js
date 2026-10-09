// Development tests resolve the *public exports* of explicitly selected checkouts.
// Production never imports this hook and contains no machine-local dependencies.
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const packages = new Map()
for (const variable of ['DSH_TEST_RULE_ENGINE', 'DSH_TEST_BLOCK_QUERY']) {
  const root = process.env[variable]
  if (!root) continue
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  packages.set(manifest.name, { root, exports: manifest.exports })
}
registerHooks({ resolve(specifier, context, next) {
  for (const [name, manifest] of packages) {
    if (specifier !== name && !specifier.startsWith(name + '/')) continue
    const key = specifier === name ? '.' : '.' + specifier.slice(name.length)
    const leaf = manifest.exports[key]
    if (typeof leaf !== 'string') throw new Error(`Test package has no public export ${specifier}`)
    return next(pathToFileURL(resolve(manifest.root, leaf)).href, context)
  }
  return next(specifier, context)
} })
