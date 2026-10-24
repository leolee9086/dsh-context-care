import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent';
import type { TextSampleValue } from './conditions.js';
export interface OutputConfig {
    maxStreamChars: number;
    maxStreamBlocks: number;
    streamEveryChars: number;
    streamFlushMs: number;
    maxStreamPending?: number;
    maxStreamPendingBytes?: number;
}
export interface OutputEvidence {
    attemptId: string;
    turn: number;
    step: number;
    index: number;
    type: 'text' | 'reasoning';
    text: string;
    /** The attempt's readable text so far, tail-capped like a block; `current-output` counts read this. */
    full: string;
    offset: number;
}
export interface OutputEvent {
    type: 'assistant.output';
    sessionId: string;
    callId: string;
    rootCallId: string;
    clock: {
        at: number;
    };
    output: OutputEvidence;
    textSamples: TextSampleValue[];
}
/** Native chunk times and the committed terminal event time drive the fold. */
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
interface StreamOptions<Agent> {
    config: OutputConfig;
    submit: (event: OutputEvent) => Promise<void>;
    afterSubmit: (agent: Agent, output: OutputEvidence) => Promise<void> | void;
    report: (error: unknown) => void;
    enabled: (sessionId: string) => boolean;
    sessionId: (agent: Agent) => string;
    /** The Host derives this key from the native step/preceding-attempt boundary. */
    attemptId?: (agent: Agent) => string;
}
/** Bounded live scheduling around the same timestamp fold used by native replay. */
export declare function createOutputStream<Agent>({ config, submit, afterSubmit, report, enabled, sessionId: identify, attemptId: identifyAttempt }: StreamOptions<Agent>): {
    observe: (agent: Agent, frame: OutputFrame) => void;
    /** No committed stream exists for abandonment; it cannot supply complete evidence. */
    abandon(agent: Agent, frame: {
        attemptId: string;
        revision: number;
    }): void;
    isCurrent(agent: Agent, output: OutputEvidence): boolean;
    close(): Promise<void>;
};
export {};
