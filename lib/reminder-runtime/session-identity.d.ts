import type { Context } from '@deepseek-ai/cordis';
import type { RecipientFacts } from './scope.js';
/**
 * Read current recipient identity from native Session facts and Host registries.
 * A persisted Session stays detached; resolving it never creates an Agent.
 * @param ctx - owner of the native query, projection and preset services.
 * @returns a cancellable identity reader for live or persisted Sessions.
 */
export declare function createSessionIdentityResolver(ctx: Context): (id: string, signal?: AbortSignal) => Promise<RecipientFacts>;
