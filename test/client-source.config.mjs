import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// All providers are supplied explicitly by a read-only external test Host.
if (!process.env.DSH_TEST_CHECKOUT) throw new Error('DSH_TEST_CHECKOUT is required')
const checkout = resolve(process.env.DSH_TEST_CHECKOUT)
const hostRequire = createRequire(pathToFileURL(resolve(checkout, 'package.json')))
const ts = hostRequire('typescript')
const parsed = ts.readConfigFile(resolve(checkout, 'tsconfig.base.json'), ts.sys.readFile)
if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'))
const paths = parsed.config.compilerOptions.paths
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alias = Object.entries(paths).map(([name, values]) => ({
  find: new RegExp(`^${name.split('*').map(escape).join('(.*)')}$`),
  replacement: resolve(checkout, values[0].replace('*', '$1')),
}))
for (const [name, file] of Object.entries({ 'sidebar-service': 'service', 'sidebar-tabs': 'tab-registry', 'sidebar-store': 'stores' })) {
  alias.unshift({ find: `@care-test/${name}`, replacement: resolve(checkout, `packages/client/ui-sidebar-right/src/client/${file}.ts`) })
}
const clientRequire = createRequire(pathToFileURL(resolve(checkout, 'packages/test-support/client-runtime/package.json')))
for (const name of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'react-dom/test-utils', '@testing-library/react']) {
  alias.unshift({ find: new RegExp(`^${escape(name)}$`), replacement: clientRequire.resolve(name) })
}
export default { resolve: { alias }, cacheDir: resolve('node_modules/.cache/context-care-client-test'),
  test: { environment: 'jsdom', include: ['test/client-assembly.spec.js'], testTimeout: 10000,
    deps: { moduleDirectories: ['node_modules', resolve(checkout, 'node_modules')] } } }
