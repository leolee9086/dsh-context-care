import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { client: 'src/client.js' }, outDir: 'lib', format: 'cjs', platform: 'browser',
  // Nested wire validation bundles Zod; minify its parser machinery while
  // retaining source maps and readable authored source for review.
  target: 'es2022', dts: false, sourcemap: true, minify: true,
  deps: { neverBundle: specifier => specifier === 'react', alwaysBundle: specifier => specifier !== 'react' },
  plugins: [{
    name: 'encode-parser-template-whitespace',
    renderChunk(code) {
      // Zod's generated-code template contains a whitespace-only line. Encode
      // those spaces as escapes: runtime text stays identical and diff checks
      // remain clean. Line count stays unchanged for the surrounding source map.
      const next = code.replace(/\n {8}\n(?= {8}if \()/g, `\n${String.raw`\x20`.repeat(8)}\n`)
      return next === code ? null : { code: next, map: null }
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-context-care", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
