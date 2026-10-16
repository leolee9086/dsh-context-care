import type { Context } from '@deepseek-ai/cordis';
import type { RecipientFacts } from './scope.js';
/** Read the recipient's current preset metadata and selected model from Host services. */
export declare function createSessionIdentityResolver(ctx: Context): (id: string, signal?: AbortSignal) => Promise<RecipientFacts>;
