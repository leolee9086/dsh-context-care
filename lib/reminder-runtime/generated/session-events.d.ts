/** The DSH release this catalog was generated from. */
export declare const SESSION_EVENT_SOURCE_VERSION = "0.2.1-rc.2";
/** Every built-in event type of that release; the only source of event names. */
export declare const SESSION_EVENT_TYPES: readonly ["agent-preset/selected", "agent/inbox/spliced", "approval/asked", "approval/decided", "approval/policy", "assistant/attempt", "assistant/message", "command/done", "command/run", "compaction/end", "compaction/prune", "compaction/start", "compaction/summary", "deliverables/presented", "developer/message", "feedback/message-delete", "feedback/message-put", "feedback/record", "goal/change", "hook/invoked", "hook/result", "image/offload", "job/registered", "job/settled", "llm/retry", "llm/retry-started", "model/selection", "permission/preset", "plan/mode", "request/context", "request/header", "sandbox/mode", "schedule/change", "session-log-deepseek/delivery-accepted", "session/end-seed", "session/title", "session/title-llm-request", "step/end", "step/start", "subagent/catalog", "subagent/descriptor", "subagent/model-selection-policy", "system/message", "team/member", "team/message/delivered", "team/message/queued", "team/task", "todo/write", "tool-workflow/agent-end", "tool-workflow/agent-start", "tool-workflow/run-end", "tool-workflow/run-start", "tool/call", "tool/ptc-dispatch", "tool/ptc-dispatch-start", "tool/result", "turn/end", "turn/start", "user/message", "web/deepseek-search-llm-request", "working-directory/change", "workspace/changes"];
/** One built-in event name known to this release. */
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];
/**
 * The payload structure behind `event.arguments.<field>` for one event.
 *
 * `null` is a scalar leaf (no selector continues past it), `'any'` is opaque,
 * `object` lists the declared fields plus an index shape for additional keys,
 * `array` describes every element, and `union` accepts any listed option.
 */
export type EventFieldShape = null | 'any' | {
    kind: 'object';
    fields: Record<string, EventFieldShape>;
    index: EventFieldShape | null;
} | {
    kind: 'array';
    element: EventFieldShape;
} | {
    kind: 'union';
    options: EventFieldShape[];
};
/** Payload shapes for every event; a rule selector is checked against these. */
export declare const SESSION_EVENT_PAYLOAD_SHAPES: Record<SessionEventType, EventFieldShape>;
/** Number of built-in event types in this catalog. */
export declare const SESSION_EVENT_COUNT = 62;
