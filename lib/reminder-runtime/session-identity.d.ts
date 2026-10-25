import type { Context } from '@deepseek-ai/cordis';
import type { RecipientFacts } from './scope.js';
/** Read current recipient facts through the Host's shared native log access. */
export declare function createSessionIdentityResolver(ctx: Context): (id: string, signal?: AbortSignal) => Promise<RecipientFacts>;
