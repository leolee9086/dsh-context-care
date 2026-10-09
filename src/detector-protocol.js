import Ajv from 'ajv'
import { Script } from 'node:vm'

/** Preserve JSON semantics rather than silently dropping undefined, getters or prototype properties. */
export function assertDetectorJson(value, depth = 0, seen = new Set()) {
  if (depth > 32) throw new Error('detector-json-depth-exceeded')
  if (value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('detector-value-must-be-json')
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('detector-value-must-be-plain-json')
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) || !property.enumerable || !Object.hasOwn(property, 'value')) throw new Error('detector-invalid-json-property')
    assertDetectorJson(property.value, depth + 1, seen)
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new Error('detector-sparse-array')
  seen.delete(value)
}
export function detectorValidator(schema, cache) {
  assertDetectorJson(schema)
  const key = JSON.stringify(schema)
  if (Buffer.byteLength(key, 'utf8') > 65536) throw new Error('detector-schema-budget-exceeded')
  // Workers cache pure schema compilation by its full definition. Runtime state is never cached here.
  if (cache?.has(key)) {
    const validate = cache.get(key); cache.delete(key); cache.set(key, validate); return validate
  }
  const validate = new Ajv({ strict: true, allErrors: true, validateFormats: false }).compile(schema)
  if (cache) { if (cache.size >= 16) cache.delete(cache.keys().next().value); cache.set(key, validate) }
  return validate
}
export function validateDetectorValue(validate, value, label, maxBytes) {
  assertDetectorJson(value)
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) throw new Error(`detector-${label}-budget-exceeded`)
  if (!validate(value)) throw new Error(`detector-${label}-schema-invalid`)
  return value
}
/** Trusted, synchronous, self-contained plugin functions. Closure values are never transferred. */
export function detectorCallbackSource(callback) {
  if (typeof callback !== 'function' || callback.constructor?.name !== 'Function') throw new Error('detector-callback-must-be-synchronous-function')
  let source = Function.prototype.toString.call(callback)
  if (source.length > 65536) throw new Error('detector-callback-source-budget-exceeded')
  try { new Script(`(${source})`) }
  catch {
    source = `function ${source}` // Object-method syntax needs a function expression in the worker.
    try { new Script(`(${source})`) } catch { throw new Error('detector-callback-source-invalid') }
  }
  return source
}
