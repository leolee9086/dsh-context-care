import Handlebars from 'handlebars'
import { bindInputs, sanitizeRegexMacro } from './vendor/rule-engine/index.js'

const unsafe = new Set(['__proto__', 'prototype', 'constructor'])
const allowed = new Set(['if', 'unless', 'each', 'with', 'eq', 'json', 'regexEscape'])
const disabledHelpers = new Set(['lookup', 'log', 'helperMissing', 'blockHelperMissing'])
function frozenJson(value, depth = 0) {
  if (depth > 32) throw new Error('template-snapshot-too-deep')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value || typeof value !== 'object') throw new Error('template-snapshot-requires-json')
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('template-snapshot-requires-json')
  // Handlebars invokes function-valued paths. Inspect descriptors before reading
  // values so copying the snapshot cannot run a getter either.
  const fields = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(fields)) {
    if (typeof key !== 'string') throw new Error('template-snapshot-requires-json')
    if (unsafe.has(key)) throw new Error('template-dangerous-property')
    if (!Object.hasOwn(fields[key], 'value')) throw new Error('template-snapshot-accessor-denied')
  }
  if (array) {
    const out = []
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(fields, index)) throw new Error('template-snapshot-requires-json')
      out.push(frozenJson(fields[index].value, depth + 1))
    }
    if (Object.keys(fields).length !== value.length + 1) throw new Error('template-snapshot-requires-json')
    return Object.freeze(out)
  }
  const out = {} // Handlebars includes the containing object in strict-mode errors.
  for (const [key, field] of Object.entries(fields)) {
    // Optional host fields are omitted; a referenced omitted field still fails in strict mode.
    if (field.value !== undefined) out[key] = frozenJson(field.value, depth + 1)
  }
  return Object.freeze(out)
}
/** Strict, single-pass prompt templates. No JS/eval/IO helpers and no HTML entity encoding. */
export function createTemplates({ maxTemplateChars = 16384, maxOutputChars = 65536, maxIterations = 256, maxPartialDepth = 8 } = {}) {
  const env = Handlebars.create()
  const partials = new Map(); const helpers = new Map(); const cache = new Map()
  let frame
  env.unregisterHelper('lookup'); env.unregisterHelper('log')
  env.registerHelper('eq', (a, b) => a === b)
  env.registerHelper('json', value => JSON.stringify(value))
  env.registerHelper('regexEscape', value => sanitizeRegexMacro(value))
  env.registerHelper('each', function (value, options) {
    if (value === null || typeof value !== 'object') throw new Error('template-each-requires-collection')
    const entries = Array.isArray(value) ? value.map((child, index) => [index, child]) : Object.entries(value)
    if (!entries.length) return options.inverse(this)
    let text = ''
    for (let i = 0; i < entries.length; i++) {
      if (++frame.iterations > maxIterations) throw new Error('template-loop-budget-exceeded')
      const [key, child] = entries[i]
      const data = env.createFrame(options.data)
      Object.assign(data, { key, index: i, first: i === 0, last: i === entries.length - 1 })
      text += options.fn(child, { data, blockParams: [child, key] })
      if (text.length > maxOutputChars) throw new Error('template-output-too-large')
    }
    return text
  })
  function validate(source) {
    if (typeof source !== 'string' || source.length > maxTemplateChars) throw new Error('template-too-large')
    const ast = env.parse(source)
    const visit = node => {
      if (!node || typeof node !== 'object') return
      if (['Decorator', 'DecoratorBlock', 'RawBlock', 'PartialBlockStatement'].includes(node.type)) throw new Error('template-unsupported-directive')
      if (node.type === 'PathExpression' && node.parts.some(part => unsafe.has(part))) throw new Error('template-dangerous-path')
      if (['MustacheStatement', 'BlockStatement', 'SubExpression'].includes(node.type)) {
        const name = node.path?.original
        if (disabledHelpers.has(name) || (node.params?.length || node.hash?.pairs?.length || node.type === 'BlockStatement' || node.type === 'SubExpression')
          && !allowed.has(name) && !helpers.has(name)) throw new Error(`template-helper-unavailable: ${name}`)
      }
      if (node.type === 'PartialStatement' && node.name.type !== 'PathExpression') throw new Error('template-dynamic-partial-unavailable')
      for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child)
    }
    visit(ast)
    return source
  }
  function compiled(source) {
    let render = cache.get(source)
    if (!render) {
      // Prompt authors keep their line breaks, including a line containing only a named partial.
      render = env.compile(validate(source), { strict: true, noEscape: true, ignoreStandalone: true, knownHelpersOnly: false })
      cache.set(source, render)
      if (cache.size > 256) cache.delete(cache.keys().next().value)
    }
    return render
  }
  return {
    validate,
    /** Each render environment owns its limits and frame; registrations are copied, never mutated by a document. */
    fork() {
      const copy = createTemplates({ maxTemplateChars, maxOutputChars, maxIterations, maxPartialDepth })
      for (const [name, { revision, render }] of helpers) copy.registerHelper({ name, revision, render })
      for (const [name, { revision, template }] of partials) copy.registerPartial({ name, revision, template })
      return copy
    },
    registerPartial({ name, revision, template }) {
      if (!name || !revision || partials.has(name)) throw new Error('template-partial-conflict')
      const render = compiled(template)
      const wrapped = (context, options) => {
        if (++frame.partialDepth > maxPartialDepth) throw new Error('template-partial-depth-exceeded')
        try { return render(context, options) } finally { frame.partialDepth-- }
      }
      partials.set(name, { revision, template, wrapped }); env.registerPartial(name, wrapped)
      return () => { if (partials.get(name)?.wrapped === wrapped) { partials.delete(name); env.unregisterPartial(name) } }
    },
    registerHelper({ name, revision, render }) {
      if (!name || !revision || allowed.has(name) || helpers.has(name) || unsafe.has(name) || disabledHelpers.has(name)) throw new Error('template-helper-conflict')
      if (typeof render !== 'function') throw new Error('template-helper-render-required')
      // Registration is trusted plugin code; values passed to it are immutable snapshots.
      helpers.set(name, { revision, render }); env.registerHelper(name, render)
      return () => { if (helpers.get(name)?.render === render) { helpers.delete(name); env.unregisterHelper(name) } }
    },
    render(source, snapshot) {
      if (frame) throw new Error('template-reentrant-render')
      frame = { iterations: 0, partialDepth: 0 }
      try {
        const text = compiled(source)(frozenJson(snapshot), { allowProtoMethodsByDefault: false, allowProtoPropertiesByDefault: false })
        if (text.length > maxOutputChars) throw new Error('template-output-too-large')
        return text
      } finally { frame = undefined }
    },
    bind: (input, snapshot) => bindInputs(input, frozenJson(snapshot)),
    versions: () => ({ partials: [...partials].map(([name, value]) => ({ name, revision: value.revision })), helpers: [...helpers].map(([name, value]) => ({ name, revision: value.revision })) }),
  }
}
