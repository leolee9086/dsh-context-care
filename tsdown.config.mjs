import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { client: 'src/client.js' }, outDir: 'lib', format: 'cjs', platform: 'browser',
  target: 'es2022', dts: false, sourcemap: true,
  deps: { neverBundle: specifier => specifier === 'react', alwaysBundle: specifier => specifier !== 'react' },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-context-care", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
