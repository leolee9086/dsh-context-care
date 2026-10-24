import test from 'node:test'
import assert from 'node:assert/strict'
import { requestFingerprint } from '../src/request-journal.js'

// The former fake storage ACK/failure cases asserted a second durable authority.
// Session recovery, request calibration and zero request-domain files now run
// through the real Loader in integration.test.js ('real request cache rebuilds').
test('request fingerprints distinguish actual JSON-visible input', () => {
  const input = { messages: [{ role: 'user', content: [{ type: 'text', text: 'one' }] }], tools: [] }
  assert.equal(requestFingerprint(input), requestFingerprint(structuredClone(input)))
  assert.notEqual(requestFingerprint(input), requestFingerprint({ ...input, messages: [] }))
  assert.match(requestFingerprint(input), /^[a-f0-9]{64}$/u)
})
