import type { EventFieldShape, SessionEventType } from './generated/session-events.js';
import type { DeclaredEvents } from './schema.js';
import type { EventValue } from './state.js';
export interface CustomEventDescriptor {
    name: string;
    shape?: EventFieldShape;
    /** The actual committed Session payload, unchanged, supplies this alias's input. */
    nativeEvent?: SessionEventType;
}
/** Custom names select native facts; they do not introduce another event journal. */
export declare function createCustomEvents(requireNative: boolean): {
    has: (name: string) => boolean;
    nativeName: (name: string) => "agent-preset/selected" | "agent/inbox/spliced" | "approval/asked" | "approval/decided" | "approval/policy" | "assistant/attempt" | "assistant/message" | "command/done" | "command/run" | "compaction/end" | "compaction/prune" | "compaction/start" | "compaction/summary" | "deliverables/presented" | "developer/message" | "feedback/message-delete" | "feedback/message-put" | "feedback/record" | "goal/change" | "hook/invoked" | "hook/result" | "image/offload" | "job/registered" | "job/settled" | "llm/retry" | "llm/retry-started" | "model/selection" | "permission/preset" | "plan/mode" | "request/context" | "request/header" | "sandbox/mode" | "schedule/change" | "session-log-deepseek/delivery-accepted" | "session/end-seed" | "session/title" | "session/title-llm-request" | "step/end" | "step/start" | "subagent/catalog" | "subagent/descriptor" | "subagent/model-selection-policy" | "system/message" | "team/member" | "team/message/delivered" | "team/message/queued" | "team/task" | "todo/write" | "tool-workflow/agent-end" | "tool-workflow/agent-start" | "tool-workflow/run-end" | "tool-workflow/run-start" | "tool/call" | "tool/ptc-dispatch" | "tool/ptc-dispatch-start" | "tool/result" | "turn/end" | "turn/start" | "user/message" | "web/deepseek-search-llm-request" | "working-directory/change" | "workspace/changes" | undefined;
    declared(): DeclaredEvents;
    aliases(nativeName: string): string[];
    selections(names: string[]): {
        name: string;
        nativeEvent: "agent-preset/selected" | "agent/inbox/spliced" | "approval/asked" | "approval/decided" | "approval/policy" | "assistant/attempt" | "assistant/message" | "command/done" | "command/run" | "compaction/end" | "compaction/prune" | "compaction/start" | "compaction/summary" | "deliverables/presented" | "developer/message" | "feedback/message-delete" | "feedback/message-put" | "feedback/record" | "goal/change" | "hook/invoked" | "hook/result" | "image/offload" | "job/registered" | "job/settled" | "llm/retry" | "llm/retry-started" | "model/selection" | "permission/preset" | "plan/mode" | "request/context" | "request/header" | "sandbox/mode" | "schedule/change" | "session-log-deepseek/delivery-accepted" | "session/end-seed" | "session/title" | "session/title-llm-request" | "step/end" | "step/start" | "subagent/catalog" | "subagent/descriptor" | "subagent/model-selection-policy" | "system/message" | "team/member" | "team/message/delivered" | "team/message/queued" | "team/task" | "todo/write" | "tool-workflow/agent-end" | "tool-workflow/agent-start" | "tool-workflow/run-end" | "tool-workflow/run-start" | "tool/call" | "tool/ptc-dispatch" | "tool/ptc-dispatch-start" | "tool/result" | "turn/end" | "turn/start" | "user/message" | "web/deepseek-search-llm-request" | "working-directory/change" | "workspace/changes";
    }[];
    register(descriptors: CustomEventDescriptor[]): () => void;
    /** Only the native resolver or discovery fold can supply this canonical input. */
    project(name: string, native: EventValue): EventValue;
};
