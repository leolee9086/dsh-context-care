import type { OutputEvidence } from './output-stream.js';
import type { MessageView } from './request-context.js';
import type { createReminderRuntime } from './runtime.js';
type Runtime = ReturnType<typeof createReminderRuntime>;
type ReminderMessage = Awaited<ReturnType<Runtime['collect']>>[number];
interface InterruptOptions<Agent> {
    runtime: Pick<Runtime, 'snapshot' | 'collect' | 'filterMessages' | 'rollback'>;
    maxInterrupts: number;
    sessionId: (agent: Agent) => string;
    humanTurn: (agent: Agent) => string;
    visible: (agent: Agent) => MessageView[];
    isCurrent: (agent: Agent, output: OutputEvidence) => boolean;
    cancel: (agent: Agent) => void;
    steer: (agent: Agent, message: ReminderMessage) => void;
}
/** Reuse reserved reminder messages for cancel/steer, with one budget across automatic resumptions. */
export declare function createOutputInterrupt<Agent>(options: InterruptOptions<Agent>): (agent: Agent, output: OutputEvidence) => Promise<void>;
export {};
