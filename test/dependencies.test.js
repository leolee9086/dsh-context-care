import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Public development packages check Host contracts. Installed runtime code must
// still obtain those services through Cordis, without loading another Host.
test('runtime stays independent from DSH implementation and local checkouts', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[group] ?? {})) {
      if (group !== 'devDependencies') assert.doesNotMatch(name, /^@deepseek-ai\/dsh(?:-|$)/)
      assert.doesNotMatch(version, /^(?:link|file|workspace):|^(?:[A-Za-z]:[\\/]|\/)|deepseek-harness/)
    }
  }
  for (const directory of ['src', 'lib']) {
    for (const entry of await readdir(new URL(`../${directory}/`, import.meta.url), { recursive: true })) {
      if (!/\.(?:[cm]?js|tsx?)$/.test(entry) || entry.endsWith('.d.ts')) continue
      const source = await readFile(new URL(`../${directory}/${entry.replaceAll('\\', '/')}`, import.meta.url), 'utf8')
      assert.doesNotMatch(source, /deepseek-harness|DSH_TEST_CHECKOUT/, entry)
      // Erase type-only imports and JSDoc exactly as compilation does, then
      // inspect executable code, including dynamic imports in nested modules.
      const runtime = ts.transpileModule(source, { fileName: entry, compilerOptions: {
        target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
      } }).outputText
      assert.doesNotMatch(runtime, /@deepseek-ai\/dsh(?:-|[/'"])/, entry)
    }
  }
  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.doesNotMatch(lock, /(?:link:|file:).*deepseek-harness/)
})

// Keep the plugin/library boundary observable. A missing value export must fail
// this gate even when the importing JS file is outside TypeScript's checkJs set.
test('engine symbols resolve directly to the installed package without forwarding shims', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url)), engine = '@leolee9086/dsh-rule-engine'
  const files = []
  for (const directory of ['src', 'lib']) for (const name of await readdir(resolve(root, directory), { recursive: true })) {
    if (/\.(?:js|ts)$/.test(name)) files.push(resolve(root, directory, name))
  }
  const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowJs: true, skipLibCheck: true, noEmit: true })
  const checker = program.getTypeChecker(), values = new Map()
  for (const file of files) {
    const source = program.getSourceFile(file), imported = new Set()
    for (const node of source.statements) {
      if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        assert.notEqual(node.name.text, 'EventFieldShape', `${file}: duplicate engine-owned generated shape`)
      }
    }
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !node.moduleSpecifier.text.startsWith(engine)) continue
      const target = node.moduleSpecifier.text, symbol = checker.getSymbolAtLocation(node.moduleSpecifier)
      assert.ok(symbol, `${file}: ${target}`)
      const types = new Set(checker.getExportsOfModule(symbol).map(symbol => symbol.name))
      const bindings = node.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      if (!values.has(target)) values.set(target, await import(target))
      for (const spec of bindings.elements) {
        const name = (spec.propertyName ?? spec.name).text
        assert.ok(node.importClause.isTypeOnly || spec.isTypeOnly ? types.has(name) : Object.hasOwn(values.get(target), name), `${file}: missing ${target}.${name}`)
        imported.add(spec.name.text)
      }
    }
    for (const node of source.statements) {
      if (ts.isVariableStatement(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of node.declarationList.declarations) {
          if (declaration.initializer && ts.isIdentifier(declaration.initializer)) assert.ok(!imported.has(declaration.initializer.text), `${file}: aliased engine forwarding export`)
        }
      }
      if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) assert.ok(!node.moduleSpecifier.text.startsWith(engine), `${file}: engine forwarding export`)
        if (!node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) for (const spec of node.exportClause.elements) {
          assert.ok(!imported.has((spec.propertyName ?? spec.name).text), `${file}: indirect engine forwarding export`)
        }
      }
    }
  }
})

// Git packages with these lifecycle hooks require build approval in pnpm 12.
// Consumers receive committed artifacts; only the author runs release:pack.
test('release has no install-time preparation or exotic dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
    assert.equal(manifest.scripts?.[hook], undefined, hook)
  }
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const version of Object.values(manifest[group] ?? {})) {
      assert.doesNotMatch(version, /^(?:github:|git(?:\+|:)|https?:|link:|file:)/)
    }
  }
  assert.match(manifest.scripts['release:pack'], /pnpm release:check && pnpm pack/)
  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.doesNotMatch(lock, /gitHosted:|codeload\.github\.com/)
})
