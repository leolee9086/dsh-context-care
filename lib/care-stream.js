import { z } from 'zod';
/** Only requested views are materialized; paging/filter changes replace their subscription. */
export const CareSubscription = z.object({
    sessionId: z.string().min(1),
    topic: z.enum(['status', 'actions', 'prompts', 'rewrites', 'controls', 'runtime']),
    offset: z.number().int().min(0).max(100000).default(0),
    seq: z.number().int().nonnegative().optional(),
    status: z.enum(['', 'queued', 'waiting-approval', 'running', 'succeeded', 'failed', 'skipped', 'cancelled', 'unknown']).default(''),
    search: z.string().max(1024).default(''),
}).strict();
export const careSubscriptionKey = (value) => JSON.stringify(value);
const Envelope = z.object({ key: z.string(), sessionId: z.string(), topic: CareSubscription.shape.topic,
    revision: z.number().int().positive() });
export const CareFrame = z.discriminatedUnion('type', [
    Envelope.extend({ type: z.literal('snapshot'), value: z.record(z.string(), z.json()) }),
    Envelope.extend({ type: z.literal('delta'), value: z.object({ records: z.array(z.record(z.string(), z.json())), removed: z.array(z.string()) }) }),
    Envelope.extend({ type: z.literal('error'), error: z.object({ name: z.string(), message: z.string() }) }),
]);
// Wire limit, including the envelope and newline. Both peers reject an oversized
// frame explicitly; the browser never buffers an unbounded partial JSON value.
export const CARE_FRAME_BYTES = 16 * 1024 * 1024;
//# sourceMappingURL=care-stream.js.map