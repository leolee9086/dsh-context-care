// Compatibility entry for existing Host and workbench imports. The pool owns its
// queue, execution budgets and termination lifecycle in checked TypeScript.
export { createBoundedMatcher, MatcherFailure } from '../lib/matcher/pool.js'
