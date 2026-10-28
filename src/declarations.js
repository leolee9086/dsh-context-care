import { createTemplates, validateDocument as validate, importWorkbench as convert } from '@leolee9086/dsh-rule-engine'




// Public pure entry: converting data never mounts services, saves documents or executes tools.
// A fresh template registry keeps conversions independent of other callers.
export function validateDocument(document) { return validate(document, createTemplates()) }
export function importDeclarations(input) { return convert(input, createTemplates()) }
