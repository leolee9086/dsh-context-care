import type { Context } from '@deepseek-ai/cordis';
import type { createCareChanges } from './care-changes.js';
/** One authenticated stream multiplexes retained Sessions and coalesces backpressure. */
export declare function installChangeRoute(ctx: Context, changes: ReturnType<typeof createCareChanges>): () => void;
