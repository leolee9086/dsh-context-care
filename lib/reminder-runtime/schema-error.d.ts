/**
 * Zod v4 stores `message` as an own accessor, not a data property. Structured
 * clone copies an Error by its own data properties, so a `ZodError` that crosses
 * such a boundary arrives with an empty message; `worker_threads`/`postMessage`
 * and the test runner's cross-process error relay both clone this way.
 *
 * Converting at parse boundaries keeps a rejection diagnosable after it crosses
 * one, and the original error stays available as `cause`.
 */
export declare function schemaError(error: unknown, what: string): Error;
/** Run one schema parse, reporting a rejection as an error that survives relay. */
export declare function parseOrThrow<T>(what: string, parse: () => T): T;
