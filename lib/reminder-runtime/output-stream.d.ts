import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent';
import { createOutputStream as createStream } from '@leolee9086/dsh-rule-engine';
export type OutputFrame = (Pick<Extract<AssistantStreamFrame, {
    type: 'start';
}>, 'type' | 'revision' | 'turn' | 'step'> | Pick<Extract<AssistantStreamFrame, {
    type: 'chunk';
}>, 'type' | 'revision' | 'chunk' | 'time'> | (Pick<Extract<AssistantStreamFrame, {
    type: 'end';
}>, 'type' | 'revision'> & {
    time: number;
})) & {
    attemptId: string;
};
/** Native protocol mapping only; the library owns stream limits, clocks and work. */
export declare function createOutputStream<Agent>(options: Parameters<typeof createStream<Agent>>[0]): {
    observe(agent: Agent, frame: OutputFrame): void;
    abandon(agent: Agent, frame: {
        attemptId: string;
        revision: number;
    }): void;
    isCurrent(agent: Agent, output: Pick<import("@leolee9086/dsh-rule-engine").OutputEvidence, "attemptId">): boolean;
    close(): Promise<void>;
};
