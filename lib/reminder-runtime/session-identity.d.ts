import type { RecipientFacts } from '@leolee9086/dsh-rule-engine';
import type { Context } from '@deepseek-ai/cordis';
/** Read current recipient facts through the Host's shared native log access. */
export declare function createSessionIdentityResolver(ctx: Context): (id: string, signal?: AbortSignal) => Promise<RecipientFacts>;
