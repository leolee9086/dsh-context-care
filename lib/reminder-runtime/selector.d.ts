import { type EventFieldShape } from './generated/session-events.js';
/**
 * The snapshot a matching event is selected from: care's envelope plus the payload
 * shape behind `arguments`. Compiled types are erased at run time, so a rule's
 * selectors are checked against this instead of assumed. The snapshot exposes the
 * triggering event under both `event` and `tool`.
 *
 * A built-in event takes its payload shape from the generated catalog; a declared
 * custom event supplies the shape its descriptor declares.
 */
export declare function sessionEventShape(eventType: string, custom?: EventFieldShape): EventFieldShape;
/**
 * Name the first path segment the shape cannot reach, or `undefined` when the
 * whole path resolves. A caller turns the name into a load-time error, which is
 * what stops a misspelled selector from silently never matching.
 */
export declare function unresolvableSegment(shape: EventFieldShape, path: string): string | undefined;
/** Every field path a condition tree reads, in a stable order. */
export declare function selectorPaths(condition: unknown): string[];
