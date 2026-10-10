const { app, BrowserWindow, protocol, session } = require('electron')
const { readFileSync } = require('node:fs')
const { readFile } = require('node:fs/promises')
const { extname, resolve, sep } = require('node:path')
const { runInNewContext } = require('node:vm')
const { createConnection } = require('node:net')
const { createInterface } = require('node:readline')
const channel = createConnection(Number(process.env.DSH_TEST_IPC_PORT), '127.0.0.1')

// Execute the deployed forwarding code, not a reimplementation of its fetch.
const bundle = readFileSync(process.env.DSH_TEST_DESKTOP_MAIN, 'utf8')
const start = bundle.indexOf('//#region lib/types/web-document.js')
const end = bundle.indexOf('//#endregion', start)
if (start < 0 || end < start) throw new Error('Deployed web-document region not found')
const forward = runInNewContext(`${bundle.slice(start, end)}; forwardWebRequest`, {
  readFile, extname, resolve, sep, URL, Request, Response, Headers, fetch,
})
const schemeStart = bundle.indexOf('protocol.registerSchemesAsPrivileged([{')
const schemeEnd = bundle.indexOf('}]);', schemeStart) + 4
if (schemeStart < 0 || schemeEnd < schemeStart) throw new Error('Deployed scheme registration not found')
runInNewContext(bundle.slice(schemeStart, schemeEnd), { protocol, SCHEME: 'dsh-app' })
app.setPath('userData', process.env.DSH_TEST_DESKTOP_USER_DATA)
app.commandLine.appendSwitch('disable-gpu')
let window
let settings
let evidence = []
const send = message => channel.write(JSON.stringify(message) + '\n')
const errorData = error => ({ name: error?.name, message: error?.message, code: error?.code, cause: error?.cause?.code })

app.whenReady().then(() => {
  protocol.handle('dsh-app', async request => {
    const destination = new URL(request.url).pathname === '/context-care/display' ? settings.displayBase ?? settings.base : settings.base
    try { return await forward(request, destination, settings.cookie) }
    catch (error) {
      evidence.push({ surface: 'protocol', path: new URL(request.url).pathname, error: errorData(error) })
      throw error
    }
  })
  const filter = { urls: ['dsh-app://app/*'] }
  session.defaultSession.webRequest.onCompleted(filter, details => {
    if (new URL(details.url).pathname === '/context-care/display') evidence.push({ surface: 'renderer-response', status: details.statusCode })
  })
  session.defaultSession.webRequest.onErrorOccurred(filter, details => {
    evidence.push({ surface: 'renderer-network', path: new URL(details.url).pathname, error: details.error })
  })
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  window.webContents.on('console-message', (_event, _level, message) => {
    if (message.includes('Error') || message.includes('error')) evidence.push({ surface: 'renderer-console', message })
  })
  send({ kind: 'ready', versions: process.versions })
}).catch(error => { send({ kind: 'fatal', error: errorData(error) }); app.exit(1) })

createInterface({ input: channel }).on('line', async line => {
  const message = JSON.parse(line)
  if (message.kind === 'close') { app.exit(0); return }
  if (message.kind !== 'run') return
  settings = message
  evidence = []
  try {
    await window.loadURL('dsh-app://app/care-test/legacy/page')
    const snapshots = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      let settledAt;
      const timer = setInterval(() => {
        const rows = window.records && [...window.records.source.getSnapshot().values()];
        if (window.readerReady && rows.length === ${message.count ?? 8} && rows.every(row => row.status === ${JSON.stringify(message.status)})) {
          settledAt ??= Date.now();
          if (Date.now() - settledAt < ${message.holdMs ?? 0}) return;
          clearInterval(timer); window.records.dispose(); resolve(rows);
        } else if (Date.now() - started > 20000) {
          clearInterval(timer); window.records?.dispose(); reject(new Error('Reader settlement timeout: ' + JSON.stringify(rows)));
        }
      }, 20);
    })`)
    send({ kind: 'result', snapshots, evidence })
  } catch (error) { send({ kind: 'result', error: errorData(error), evidence }) }
})
channel.on('close', () => app.exit(0))
