import { createTemplates } from './templates.js'
import { validateDocument as validate } from './workbench-store.js'
import { importWorkbench as convert } from './workbench-import.js'

// Public pure entry: converting data never mounts services, saves documents or executes tools.
// A fresh template registry keeps conversions independent of other callers.
export function validateDocument(document) { return validate(document, createTemplates()) }
export function importDeclarations(input) { return convert(input, createTemplates()) }
