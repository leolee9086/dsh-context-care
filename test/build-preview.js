import { build } from 'tsdown'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const checkout = process.env.DSH_TEST_CHECKOUT
if (!checkout) throw new Error('Set DSH_TEST_CHECKOUT to the official source checkout for theme tokens.')
const out = resolve('artifacts/ui-preview')
await mkdir(out, { recursive: true })
await build({ config: false, entry: { preview: 'test/preview-entry.js' }, outDir: out, platform: 'browser', format: 'iife',
  target: 'es2022', dts: false, sourcemap: false, clean: false,
  deps: { alwaysBundle: () => true }, define: { 'process.env.NODE_ENV': JSON.stringify('production') } })
const theme = await readFile(resolve(checkout, 'packages/client/ui-theme/src/styles/design-platform.css'), 'utf8')
const bundle = await readFile(resolve(out, 'preview.iife.js'), 'utf8')
// Theme source is read-only and embedded only in the ignored preview artifact.
await writeFile(resolve(out, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Context care 生产组件预览</title><style>${theme}\n
*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Microsoft YaHei',sans-serif;background:var(--dsw-alias-bg-base);--dsh-content-font-size-secondary:14px;--dsh-content-font-size:15px}#root{height:100vh;display:flex;flex-direction:column}.preview-banner{flex:none;padding:10px 16px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l2)}.preview-banner nav{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.preview-banner button{font:inherit;padding:5px 8px;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px}.preview-panel{flex:1;min-height:0;max-width:720px;width:100%;margin:auto;background:var(--dsw-alias-bg-base)}
</style><body><div id="root"></div><script>${bundle.replaceAll('</script', '<\\/script')}</script></body></html>`)
console.log(resolve(out, 'index.html'))
