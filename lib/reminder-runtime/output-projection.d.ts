import { createOutputProjection as createProjection } from '@leolee9086/dsh-rule-engine';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
export declare function createOutputProjection(...args: Parameters<typeof createProjection>): {
    deadline: number | undefined;
    push(at: number, chunk: StreamChunk): Generator<import("@leolee9086/dsh-rule-engine").OutputEvent, any, any>;
    advance: (at: number) => Generator<import("@leolee9086/dsh-rule-engine").OutputEvent>;
    finish: (at: number) => Generator<import("@leolee9086/dsh-rule-engine").OutputEvent>;
    stop(): void;
};
