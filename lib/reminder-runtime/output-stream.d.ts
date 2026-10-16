import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent';
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
}
export type OutputFrame = (Pick<Extract<AssistantStreamFrame, {
    type: 'start';
}>, 'type' | 'revision' | 'turn' | 'step'> | Pick<Extract<AssistantStreamFrame, {
    type: 'chunk';
}>, 'type' | 'revision' | 'chunk'> | Pick<Extract<AssistantStreamFrame, {
    type: 'end';
}>, 'type' | 'revision'>) & {
    attemptId: string;
};
interface StreamOptions<Agent> {
    config: OutputConfig;
    submit: (event: OutputEvent) => Promise<void>;
    afterSubmit: (agent: Agent, output: OutputEvidence) => Promise<void> | void;
    report: (error: unknown) => void;
    enabled: (sessionId: string) => boolean;
    sessionId: (agent: Agent) => string;
}
/** Bounded per-attempt, per-block windows. Only readable text/reasoning enter matching. */
export declare function createOutputStream<Agent>({ config, submit, afterSubmit, report, enabled, sessionId: identify }: StreamOptions<Agent>): {
    observe: (agent: Agent, frame: OutputFrame) => void;
    isCurrent(agent: Agent, output: OutputEvidence): boolean;
    close(): Promise<void>;
};
export {};
