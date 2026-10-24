import type { MessageId } from '@deepseek-ai/dsh-llm';
import { Source } from './schema.js';
import type { CustomEventDescriptor } from './custom-events.js';
import type { MessageView } from './request-context.js';
import type { RecipientIdentity } from './scope.js';
import type { CandidateValue, RuntimeOptions, RequestInput, CollectInput, ToolPreparation } from './state.js';
export { ReminderConfig } from './schema.js';
export { REMINDER_DOMAIN } from './state.js';
export type { RuntimeOptions } from './state.js';
/** The selector shape a custom event descriptor declares, reused from the generated catalog. */
export type { EventFieldShape } from './generated/session-events.js';
export type { CustomEventDescriptor } from './custom-events.js';
/** Public source declarations keep schema defaults optional until registration. */
export type ReminderSource = import('zod').input<typeof Source>;
export type ReminderRuleInput = ReminderSource['rules'][number];
/** Consumers take only the methods they need from the actual runtime factory. */
export type ReminderService = ReturnType<typeof createReminderRuntime>;
export type ReminderSourceHandle = ReturnType<ReminderService['registerSource']>;
export declare const REMINDER_SERVICE = "reminderRules";
/**
 * Source kind of a reminder delivery. It also guards session-event matching:
 * a delivery is itself a logged message, so matching must not consume its own output.
 */
export declare const REMINDER_MESSAGE_KIND = "plugin:dsh-context-care:reminder";
declare function reminderSource(candidate: CandidateValue, humanId: string): {
    readonly kind: "plugin:dsh-context-care:reminder";
    readonly form: "notice";
    readonly summary: string;
    readonly reminder: {
        readonly shared: {
            until?: number | undefined;
            key: string;
        } | null;
        readonly window?: {
            id: string;
            start: number;
            end: number;
        } | undefined;
        readonly handoff?: {
            revision: number;
            policy: string | number;
            format: "context-care/reminder-handoff/v1";
            sourceSignature: string;
            sticky?: {
                activationId: string;
                charged: boolean;
            } | undefined;
            request?: {
                type: "request.before";
                humanActivity?: {
                    at: number;
                    evidence: string;
                } | null | undefined;
            } | undefined;
            queued?: true | undefined;
        } | undefined;
        readonly key: string;
        readonly candidateId: string;
        readonly sessionId: string;
        readonly humanId: string;
    };
    readonly contextCareTrace: {
        readonly output?: {
            attemptId: string;
            turn: number;
            step: number;
            index: number;
            type: "text" | "reasoning";
            offset: number;
            full: string;
        } | undefined;
        readonly native?: {
            type: "tool-result" | "tool-call" | "session-event" | "assistant-output";
            seq: number;
        } | undefined;
        readonly trigger: "reminder-rule";
        readonly evaluationId: string;
        readonly ruleId: string;
        readonly sourceId: string;
        readonly callId: string;
        readonly rootCallId: string;
        readonly rule: {
            format: "reminder/v4";
            id: string;
            priority: number;
            text: string;
            on: "tool.succeeded";
            when: {
                tool: string;
                arguments: Record<string, {
                    regex: string;
                    flags: string;
                }>;
                error?: {
                    code: string;
                } | undefined;
                condition?: import("zod").JSONType | undefined;
            };
            effect: {
                kind: "remind";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
            } | {
                kind: "deny-tool";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
                dangerous: true;
                reason: string;
            };
            title?: string | undefined;
            exclusiveGroup?: string | undefined;
            scope?: import("./scope.js").RecipientScope | undefined;
            judge?: {
                ref: string;
                revision: number;
                params?: import("zod").JSONType | undefined;
                timeoutMs?: number | undefined;
            } | undefined;
        } | {
            format: "reminder/v4";
            id: string;
            priority: number;
            text: string;
            on: "tool.failed";
            when: {
                tool: string;
                arguments: Record<string, {
                    regex: string;
                    flags: string;
                }>;
                error?: {
                    code: string;
                } | undefined;
                condition?: import("zod").JSONType | undefined;
            };
            effect: {
                kind: "remind";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
            } | {
                kind: "deny-tool";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
                dangerous: true;
                reason: string;
            };
            title?: string | undefined;
            exclusiveGroup?: string | undefined;
            scope?: import("./scope.js").RecipientScope | undefined;
            judge?: {
                ref: string;
                revision: number;
                params?: import("zod").JSONType | undefined;
                timeoutMs?: number | undefined;
            } | undefined;
        } | {
            format: "reminder/v4";
            id: string;
            priority: number;
            text: string;
            on: "request.before";
            when: {
                timeWindow?: {
                    start: string;
                    end: string;
                    timeZone: "local";
                } | undefined;
                humanActivity?: {
                    withinSeconds: number;
                } | undefined;
                condition?: import("zod").JSONType | undefined;
            };
            effect: {
                kind: "remind";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
            } | {
                kind: "deny-tool";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
                dangerous: true;
                reason: string;
            };
            title?: string | undefined;
            exclusiveGroup?: string | undefined;
            scope?: import("./scope.js").RecipientScope | undefined;
            judge?: {
                ref: string;
                revision: number;
                params?: import("zod").JSONType | undefined;
                timeoutMs?: number | undefined;
            } | undefined;
        } | {
            format: "reminder/v4";
            id: string;
            priority: number;
            text: string;
            on: "assistant.output";
            when: {
                blockTypes: ("text" | "reasoning")[];
                pattern: {
                    kind: "literal";
                    text: string;
                } | {
                    kind: "keywords";
                    values: string[];
                    mode: "any" | "all";
                } | {
                    regex: string;
                    flags: string;
                    kind: "regex";
                };
                timeWindow?: {
                    start: string;
                    end: string;
                    timeZone: "local";
                } | undefined;
                condition?: import("zod").JSONType | undefined;
            };
            effect: {
                kind: "remind";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
            } | {
                kind: "deny-tool";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
                dangerous: true;
                reason: string;
            };
            title?: string | undefined;
            exclusiveGroup?: string | undefined;
            scope?: import("./scope.js").RecipientScope | undefined;
            judge?: {
                ref: string;
                revision: number;
                params?: import("zod").JSONType | undefined;
                timeoutMs?: number | undefined;
            } | undefined;
        } | {
            format: "reminder/v4";
            id: string;
            priority: number;
            text: string;
            on: "tool.before-execute";
            when: {
                tool: string;
                arguments: Record<string, {
                    regex: string;
                    flags: string;
                }>;
                condition?: import("zod").JSONType | undefined;
            };
            effect: {
                kind: "remind";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
            } | {
                kind: "deny-tool";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
                dangerous: true;
                reason: string;
            };
            title?: string | undefined;
            exclusiveGroup?: string | undefined;
            scope?: import("./scope.js").RecipientScope | undefined;
            judge?: {
                ref: string;
                revision: number;
                params?: import("zod").JSONType | undefined;
                timeoutMs?: number | undefined;
            } | undefined;
        } | {
            format: "reminder/v4";
            id: string;
            priority: number;
            text: string;
            on: "session.event";
            when: {
                eventType: string;
                condition?: import("zod").JSONType | undefined;
            };
            effect: {
                kind: "remind";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
            } | {
                kind: "deny-tool";
                deliver: {
                    model: {
                        once: "window" | "none" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                        sticky?: {
                            lifetime: number;
                            cooldown: number;
                            clock: "main-request" | "human-turn";
                        } | undefined;
                    };
                };
                dangerous: true;
                reason: string;
            };
            title?: string | undefined;
            exclusiveGroup?: string | undefined;
            scope?: import("./scope.js").RecipientScope | undefined;
            judge?: {
                ref: string;
                revision: number;
                params?: import("zod").JSONType | undefined;
                timeoutMs?: number | undefined;
            } | undefined;
        };
        readonly evidence: import("zod").JSONType;
    };
};
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'plugin:dsh-context-care:reminder': ReturnType<typeof reminderSource>;
    }
}
/** One runtime owns source snapshots, evaluation lifetimes and disposable candidates.
 * Standalone callers may supply a legacy writer; production recovery belongs to Session.
 * No Cordis or live session objects enter the scheduler. */
export declare function createReminderRuntime({ config: input, entries, sessionAuthoritative, templates, save, execute, capacity, saveCapacity, changed, dispatches, resolvePreset, resolveIdentity, resolveEvent, recoverEvents, sinceSeq, updateClaims, readDeliveries, wasHanded, readHandoffs, readQueued, handoffPending, wallNow, now, eligible, epoch, report }?: RuntimeOptions): {
    capacitySnapshot: () => {
        registeredRules: number;
        rejections: {
            sourceId: string;
            sourceRules: number;
            totalRules: number;
            limit: number;
            message: string;
        }[];
        revision: number;
        maxRules: number;
    };
    /** Evaluate natural conversation at the same boundary that collects tool reminders. */
    prepareRequest({ sessionId, agentPreset, events, visible, accepted, signal }: RequestInput): Promise<void>;
    /** Select exact action facts; the Host applies them only after the real tool result commits. */
    prepareSnooze({ sessionId, agentPreset, sourceId, ruleId }: RecipientIdentity & {
        sourceId?: string;
        ruleId?: string;
    }): Promise<{
        sourceId: string;
        ruleId: string;
        key: string;
        until: number;
    }[]>;
    /** Standalone compatibility port; production callers must use the real snooze tool. */
    snooze(input: RecipientIdentity & {
        sourceId?: string;
        ruleId?: string;
    }): Promise<{
        sourceId: string;
        ruleId: string;
        key: string;
        until: number;
    }[]>;
    setCapacity(input: unknown): Promise<{
        registeredRules: number;
        rejections: {
            sourceId: string;
            sourceRules: number;
            totalRules: number;
            limit: number;
            message: string;
        }[];
        revision: number;
        maxRules: number;
    }>;
    validateRule(input: unknown): {
        condition: import("./conditions.js").ReminderCondition;
        format: "reminder/v4";
        id: string;
        priority: number;
        text: string;
        on: "tool.succeeded";
        when: {
            tool: string;
            arguments: Record<string, {
                regex: string;
                flags: string;
            }>;
            error?: {
                code: string;
            } | undefined;
            condition?: import("zod").JSONType | undefined;
        };
        effect: {
            kind: "remind";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
        } | {
            kind: "deny-tool";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
            dangerous: true;
            reason: string;
        };
        title?: string | undefined;
        exclusiveGroup?: string | undefined;
        scope?: import("./scope.js").RecipientScope | undefined;
        judge?: {
            ref: string;
            revision: number;
            params?: import("zod").JSONType | undefined;
            timeoutMs?: number | undefined;
        } | undefined;
    } | {
        condition: import("./conditions.js").ReminderCondition;
        format: "reminder/v4";
        id: string;
        priority: number;
        text: string;
        on: "tool.failed";
        when: {
            tool: string;
            arguments: Record<string, {
                regex: string;
                flags: string;
            }>;
            error?: {
                code: string;
            } | undefined;
            condition?: import("zod").JSONType | undefined;
        };
        effect: {
            kind: "remind";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
        } | {
            kind: "deny-tool";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
            dangerous: true;
            reason: string;
        };
        title?: string | undefined;
        exclusiveGroup?: string | undefined;
        scope?: import("./scope.js").RecipientScope | undefined;
        judge?: {
            ref: string;
            revision: number;
            params?: import("zod").JSONType | undefined;
            timeoutMs?: number | undefined;
        } | undefined;
    } | {
        condition: import("./conditions.js").ReminderCondition;
        format: "reminder/v4";
        id: string;
        priority: number;
        text: string;
        on: "request.before";
        when: {
            timeWindow?: {
                start: string;
                end: string;
                timeZone: "local";
            } | undefined;
            humanActivity?: {
                withinSeconds: number;
            } | undefined;
            condition?: import("zod").JSONType | undefined;
        };
        effect: {
            kind: "remind";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
        } | {
            kind: "deny-tool";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
            dangerous: true;
            reason: string;
        };
        title?: string | undefined;
        exclusiveGroup?: string | undefined;
        scope?: import("./scope.js").RecipientScope | undefined;
        judge?: {
            ref: string;
            revision: number;
            params?: import("zod").JSONType | undefined;
            timeoutMs?: number | undefined;
        } | undefined;
    } | {
        condition: import("./conditions.js").ReminderCondition;
        format: "reminder/v4";
        id: string;
        priority: number;
        text: string;
        on: "assistant.output";
        when: {
            blockTypes: ("text" | "reasoning")[];
            pattern: {
                kind: "literal";
                text: string;
            } | {
                kind: "keywords";
                values: string[];
                mode: "any" | "all";
            } | {
                regex: string;
                flags: string;
                kind: "regex";
            };
            timeWindow?: {
                start: string;
                end: string;
                timeZone: "local";
            } | undefined;
            condition?: import("zod").JSONType | undefined;
        };
        effect: {
            kind: "remind";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
        } | {
            kind: "deny-tool";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
            dangerous: true;
            reason: string;
        };
        title?: string | undefined;
        exclusiveGroup?: string | undefined;
        scope?: import("./scope.js").RecipientScope | undefined;
        judge?: {
            ref: string;
            revision: number;
            params?: import("zod").JSONType | undefined;
            timeoutMs?: number | undefined;
        } | undefined;
    } | {
        condition: import("./conditions.js").ReminderCondition;
        format: "reminder/v4";
        id: string;
        priority: number;
        text: string;
        on: "tool.before-execute";
        when: {
            tool: string;
            arguments: Record<string, {
                regex: string;
                flags: string;
            }>;
            condition?: import("zod").JSONType | undefined;
        };
        effect: {
            kind: "remind";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
        } | {
            kind: "deny-tool";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
            dangerous: true;
            reason: string;
        };
        title?: string | undefined;
        exclusiveGroup?: string | undefined;
        scope?: import("./scope.js").RecipientScope | undefined;
        judge?: {
            ref: string;
            revision: number;
            params?: import("zod").JSONType | undefined;
            timeoutMs?: number | undefined;
        } | undefined;
    } | {
        condition: import("./conditions.js").ReminderCondition;
        format: "reminder/v4";
        id: string;
        priority: number;
        text: string;
        on: "session.event";
        when: {
            eventType: string;
            condition?: import("zod").JSONType | undefined;
        };
        effect: {
            kind: "remind";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
        } | {
            kind: "deny-tool";
            deliver: {
                model: {
                    once: "window" | "none" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                    sticky?: {
                        lifetime: number;
                        cooldown: number;
                        clock: "main-request" | "human-turn";
                    } | undefined;
                };
            };
            dangerous: true;
            reason: string;
        };
        title?: string | undefined;
        exclusiveGroup?: string | undefined;
        scope?: import("./scope.js").RecipientScope | undefined;
        judge?: {
            ref: string;
            revision: number;
            params?: import("zod").JSONType | undefined;
            timeoutMs?: number | undefined;
        } | undefined;
    };
    registerSource(input: unknown, { acceptSession }?: {
        acceptSession?: (sessionId: string) => boolean;
    }): {
        replace: (next: unknown) => void;
        dispose(): Promise<void>;
    };
    registerDetector(input: unknown): () => Promise<void>;
    registerAnalyzer(input: unknown): () => Promise<void>;
    /** Resolve current recipient facts before presenting the applicable rules. */
    catalog(sessionId: string, agentPreset?: string): Promise<{
        readOnly: boolean;
        rules: {
            id: string;
            title: string;
            description: string;
            definition: {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.succeeded";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    error?: {
                        code: string;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.failed";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    error?: {
                        code: string;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "request.before";
                when: {
                    timeWindow?: {
                        start: string;
                        end: string;
                        timeZone: "local";
                    } | undefined;
                    humanActivity?: {
                        withinSeconds: number;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "assistant.output";
                when: {
                    blockTypes: ("text" | "reasoning")[];
                    pattern: {
                        kind: "literal";
                        text: string;
                    } | {
                        kind: "keywords";
                        values: string[];
                        mode: "any" | "all";
                    } | {
                        regex: string;
                        flags: string;
                        kind: "regex";
                    };
                    timeWindow?: {
                        start: string;
                        end: string;
                        timeZone: "local";
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.before-execute";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "session.event";
                when: {
                    eventType: string;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            };
            actions: {
                id: string;
                title: string;
                defaultEnabled: boolean;
            }[];
        }[];
        scope?: import("./scope.js").RecipientScope | undefined;
        sessionId?: string | undefined;
        sourceId: string;
        plugin: string;
        registration: string;
        executor: string;
    }[]>;
    /** Synchronous action definitions for policy lookup; delivery and UI use catalog/recipient checks. */
    controlCatalog(sessionId: string): {
        readOnly: boolean;
        rules: {
            id: string;
            title: string;
            description: string;
            definition: {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.succeeded";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    error?: {
                        code: string;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.failed";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    error?: {
                        code: string;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "request.before";
                when: {
                    timeWindow?: {
                        start: string;
                        end: string;
                        timeZone: "local";
                    } | undefined;
                    humanActivity?: {
                        withinSeconds: number;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "assistant.output";
                when: {
                    blockTypes: ("text" | "reasoning")[];
                    pattern: {
                        kind: "literal";
                        text: string;
                    } | {
                        kind: "keywords";
                        values: string[];
                        mode: "any" | "all";
                    } | {
                        regex: string;
                        flags: string;
                        kind: "regex";
                    };
                    timeWindow?: {
                        start: string;
                        end: string;
                        timeZone: "local";
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.before-execute";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "session.event";
                when: {
                    eventType: string;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            };
            actions: {
                id: string;
                title: string;
                defaultEnabled: boolean;
            }[];
        }[];
        scope?: import("./scope.js").RecipientScope | undefined;
        sessionId?: string | undefined;
        sourceId: string;
        plugin: string;
        registration: string;
        executor: string;
    }[];
    submit(rawEvent: unknown, signal?: AbortSignal): Promise<void>;
    /** Evaluate denial policy before a tool body runs; the guard later reads this ticket. */
    prepareToolExecution({ key, sessionId, agentPreset, name, arguments: args, callId, rootCallId, native, signal }: ToolPreparation): Promise<void>;
    /**
     * Declare the custom events a rule may select by name. The owner keeps the returned
     * disposer inside a Cordis effect, so unloading that plugin withdraws its names:
     * nothing can publish them afterwards, and `handlesSessionEvent` reports them as
     * unreachable even though already-compiled rules still mention them.
     */
    registerCustomEvents(descriptors: CustomEventDescriptor[]): () => void;
    /**
     * Publish an alias of a committed Session event. The binding and native seq
     * determine payload, clock and idempotency; copied eventId/at/facts cannot
     * override them. Unbound events remain available only to standalone runtimes.
     */
    publishCustomEvent({ sessionId, name, eventId, at, facts, native }: {
        sessionId: string;
        name: string;
        eventId?: string;
        at?: number;
        facts?: unknown;
        native?: {
            type: "session-event";
            seq: number;
        };
    }, signal?: AbortSignal): Promise<void>;
    /**
     * Whether any registered rule selects this committed DSH event type. A session
     * event can only match a rule whose `eventType` equals it, so this pre-filter is
     * exact and keeps unrelated log traffic off the admission path.
     */
    handlesSessionEvent(eventType: string): boolean;
    /** Synchronous guard decision; never awaits, so another listener cannot re-allow a denial. */
    decideToolExecution(key: object): {
        kind: "allow";
    } | {
        kind: "deny";
        reason: string;
        error?: import("./denial.js").ReminderPreparationError;
    };
    /** Release a settled execution's ticket. */
    settleToolExecution(key: object): void;
    settle(sessionId: string): Promise<void>;
    /** Await the owning state lane; standalone writers additionally own late I/O. */
    drainPersistence(sessionId?: string): Promise<void>;
    pendingPersistence(): readonly import("./persistence.js").PersistencePending[];
    snapshot(sessionId: string): {
        sources: {
            sourceId: string;
            plugin: string;
            revision: number;
            rules: ({
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.succeeded";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    error?: {
                        code: string;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.failed";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    error?: {
                        code: string;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "request.before";
                when: {
                    timeWindow?: {
                        start: string;
                        end: string;
                        timeZone: "local";
                    } | undefined;
                    humanActivity?: {
                        withinSeconds: number;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "assistant.output";
                when: {
                    blockTypes: ("text" | "reasoning")[];
                    pattern: {
                        kind: "literal";
                        text: string;
                    } | {
                        kind: "keywords";
                        values: string[];
                        mode: "any" | "all";
                    } | {
                        regex: string;
                        flags: string;
                        kind: "regex";
                    };
                    timeWindow?: {
                        start: string;
                        end: string;
                        timeZone: "local";
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.before-execute";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "session.event";
                when: {
                    eventType: string;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            })[];
            diagnostics: {
                id: string;
                message: string;
            }[];
            sessionId?: string | undefined;
            scope?: import("./scope.js").RecipientScope | undefined;
        }[];
        storageError: boolean;
        seen: string[];
        candidates: {
            id: string;
            sessionId: string;
            sourceId: string;
            sourceToken: string;
            ruleId: string;
            key: string;
            revision: number;
            policy: string | number;
            text: string;
            title: string;
            eventId: string;
            rootCallId: string;
            status: "reserved" | "pending" | "delivered" | "discarded";
            evidence: import("zod").JSONType;
            rule: {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.succeeded";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    error?: {
                        code: string;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.failed";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    error?: {
                        code: string;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "request.before";
                when: {
                    timeWindow?: {
                        start: string;
                        end: string;
                        timeZone: "local";
                    } | undefined;
                    humanActivity?: {
                        withinSeconds: number;
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "assistant.output";
                when: {
                    blockTypes: ("text" | "reasoning")[];
                    pattern: {
                        kind: "literal";
                        text: string;
                    } | {
                        kind: "keywords";
                        values: string[];
                        mode: "any" | "all";
                    } | {
                        regex: string;
                        flags: string;
                        kind: "regex";
                    };
                    timeWindow?: {
                        start: string;
                        end: string;
                        timeZone: "local";
                    } | undefined;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "tool.before-execute";
                when: {
                    tool: string;
                    arguments: Record<string, {
                        regex: string;
                        flags: string;
                    }>;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            } | {
                format: "reminder/v4";
                id: string;
                priority: number;
                text: string;
                on: "session.event";
                when: {
                    eventType: string;
                    condition?: import("zod").JSONType | undefined;
                };
                effect: {
                    kind: "remind";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                } | {
                    kind: "deny-tool";
                    deliver: {
                        model: {
                            once: "window" | "none" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                            sticky?: {
                                lifetime: number;
                                cooldown: number;
                                clock: "main-request" | "human-turn";
                            } | undefined;
                        };
                    };
                    dangerous: true;
                    reason: string;
                };
                title?: string | undefined;
                exclusiveGroup?: string | undefined;
                scope?: import("./scope.js").RecipientScope | undefined;
                judge?: {
                    ref: string;
                    revision: number;
                    params?: import("zod").JSONType | undefined;
                    timeoutMs?: number | undefined;
                } | undefined;
            };
            agentPreset?: string | undefined;
            sourceSignature?: string | undefined;
            window?: {
                id: string;
                start: number;
                end: number;
            } | undefined;
            request?: {
                type: "request.before";
                humanActivity?: {
                    at: number;
                    evidence: string;
                } | null | undefined;
            } | undefined;
            native?: {
                type: "tool-result" | "tool-call" | "session-event" | "assistant-output";
                seq: number;
            } | undefined;
            output?: {
                attemptId: string;
                turn: number;
                step: number;
                index: number;
                type: "text" | "reasoning";
                offset: number;
                full: string;
            } | undefined;
            messageId?: string | undefined;
            queued?: true | undefined;
            rendered?: boolean | undefined;
            sticky?: {
                activationId: string;
                charged: boolean;
            } | undefined;
        }[];
        diagnostics: Record<string, import("zod").JSONType>[];
        windows: {
            key: string;
            until: number;
            messageId?: string | undefined;
        }[];
        stickies: {
            key: string;
            activationId: string;
            sourceId: string;
            ruleId: string;
            sessionId: string;
            text: string;
            title: string;
            clock: "main-request" | "human-turn";
            remaining: number;
            cooldown: number;
            charged: boolean;
            lastHumanId: string;
        }[];
    };
    /** Freeze an unreserved match into native pending input; quota is checked when a later request claims it. */
    queuePending({ sessionId, agentPreset, visible, accepted, candidateIds, signal }: CollectInput): Promise<{
        id: MessageId;
        role: "user";
        content: {
            type: "text";
            text: string;
        }[];
        source: {
            readonly kind: "plugin:dsh-context-care:reminder";
            readonly form: "notice";
            readonly summary: string;
            readonly reminder: {
                readonly shared: {
                    until?: number | undefined;
                    key: string;
                } | null;
                readonly window?: {
                    id: string;
                    start: number;
                    end: number;
                } | undefined;
                readonly handoff?: {
                    revision: number;
                    policy: string | number;
                    format: "context-care/reminder-handoff/v1";
                    sourceSignature: string;
                    sticky?: {
                        activationId: string;
                        charged: boolean;
                    } | undefined;
                    request?: {
                        type: "request.before";
                        humanActivity?: {
                            at: number;
                            evidence: string;
                        } | null | undefined;
                    } | undefined;
                    queued?: true | undefined;
                } | undefined;
                readonly key: string;
                readonly candidateId: string;
                readonly sessionId: string;
                readonly humanId: string;
            };
            readonly contextCareTrace: {
                readonly output?: {
                    attemptId: string;
                    turn: number;
                    step: number;
                    index: number;
                    type: "text" | "reasoning";
                    offset: number;
                    full: string;
                } | undefined;
                readonly native?: {
                    type: "tool-result" | "tool-call" | "session-event" | "assistant-output";
                    seq: number;
                } | undefined;
                readonly trigger: "reminder-rule";
                readonly evaluationId: string;
                readonly ruleId: string;
                readonly sourceId: string;
                readonly callId: string;
                readonly rootCallId: string;
                readonly rule: {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "tool.succeeded";
                    when: {
                        tool: string;
                        arguments: Record<string, {
                            regex: string;
                            flags: string;
                        }>;
                        error?: {
                            code: string;
                        } | undefined;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "tool.failed";
                    when: {
                        tool: string;
                        arguments: Record<string, {
                            regex: string;
                            flags: string;
                        }>;
                        error?: {
                            code: string;
                        } | undefined;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "request.before";
                    when: {
                        timeWindow?: {
                            start: string;
                            end: string;
                            timeZone: "local";
                        } | undefined;
                        humanActivity?: {
                            withinSeconds: number;
                        } | undefined;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "assistant.output";
                    when: {
                        blockTypes: ("text" | "reasoning")[];
                        pattern: {
                            kind: "literal";
                            text: string;
                        } | {
                            kind: "keywords";
                            values: string[];
                            mode: "any" | "all";
                        } | {
                            regex: string;
                            flags: string;
                            kind: "regex";
                        };
                        timeWindow?: {
                            start: string;
                            end: string;
                            timeZone: "local";
                        } | undefined;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "tool.before-execute";
                    when: {
                        tool: string;
                        arguments: Record<string, {
                            regex: string;
                            flags: string;
                        }>;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "session.event";
                    when: {
                        eventType: string;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                };
                readonly evidence: import("zod").JSONType;
            };
        };
    }[]>;
    collect({ sessionId, agentPreset, visible, accepted, committedIds, signal, candidateIds }: CollectInput): Promise<{
        id: MessageId;
        role: "user";
        content: {
            type: "text";
            text: string;
        }[];
        source: {
            readonly kind: "plugin:dsh-context-care:reminder";
            readonly form: "notice";
            readonly summary: string;
            readonly reminder: {
                readonly shared: {
                    until?: number | undefined;
                    key: string;
                } | null;
                readonly window?: {
                    id: string;
                    start: number;
                    end: number;
                } | undefined;
                readonly handoff?: {
                    revision: number;
                    policy: string | number;
                    format: "context-care/reminder-handoff/v1";
                    sourceSignature: string;
                    sticky?: {
                        activationId: string;
                        charged: boolean;
                    } | undefined;
                    request?: {
                        type: "request.before";
                        humanActivity?: {
                            at: number;
                            evidence: string;
                        } | null | undefined;
                    } | undefined;
                    queued?: true | undefined;
                } | undefined;
                readonly key: string;
                readonly candidateId: string;
                readonly sessionId: string;
                readonly humanId: string;
            };
            readonly contextCareTrace: {
                readonly output?: {
                    attemptId: string;
                    turn: number;
                    step: number;
                    index: number;
                    type: "text" | "reasoning";
                    offset: number;
                    full: string;
                } | undefined;
                readonly native?: {
                    type: "tool-result" | "tool-call" | "session-event" | "assistant-output";
                    seq: number;
                } | undefined;
                readonly trigger: "reminder-rule";
                readonly evaluationId: string;
                readonly ruleId: string;
                readonly sourceId: string;
                readonly callId: string;
                readonly rootCallId: string;
                readonly rule: {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "tool.succeeded";
                    when: {
                        tool: string;
                        arguments: Record<string, {
                            regex: string;
                            flags: string;
                        }>;
                        error?: {
                            code: string;
                        } | undefined;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "tool.failed";
                    when: {
                        tool: string;
                        arguments: Record<string, {
                            regex: string;
                            flags: string;
                        }>;
                        error?: {
                            code: string;
                        } | undefined;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "request.before";
                    when: {
                        timeWindow?: {
                            start: string;
                            end: string;
                            timeZone: "local";
                        } | undefined;
                        humanActivity?: {
                            withinSeconds: number;
                        } | undefined;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "assistant.output";
                    when: {
                        blockTypes: ("text" | "reasoning")[];
                        pattern: {
                            kind: "literal";
                            text: string;
                        } | {
                            kind: "keywords";
                            values: string[];
                            mode: "any" | "all";
                        } | {
                            regex: string;
                            flags: string;
                            kind: "regex";
                        };
                        timeWindow?: {
                            start: string;
                            end: string;
                            timeZone: "local";
                        } | undefined;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "tool.before-execute";
                    when: {
                        tool: string;
                        arguments: Record<string, {
                            regex: string;
                            flags: string;
                        }>;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                } | {
                    format: "reminder/v4";
                    id: string;
                    priority: number;
                    text: string;
                    on: "session.event";
                    when: {
                        eventType: string;
                        condition?: import("zod").JSONType | undefined;
                    };
                    effect: {
                        kind: "remind";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                    } | {
                        kind: "deny-tool";
                        deliver: {
                            model: {
                                once: "window" | "none" | "surface";
                                shared?: {
                                    reset: "lifetime";
                                    lifetime: string;
                                    limit: number;
                                } | {
                                    reset: "window";
                                    limit: number;
                                } | undefined;
                                interrupt?: "abort-resume" | undefined;
                                sticky?: {
                                    lifetime: number;
                                    cooldown: number;
                                    clock: "main-request" | "human-turn";
                                } | undefined;
                            };
                        };
                        dangerous: true;
                        reason: string;
                    };
                    title?: string | undefined;
                    exclusiveGroup?: string | undefined;
                    scope?: import("./scope.js").RecipientScope | undefined;
                    judge?: {
                        ref: string;
                        revision: number;
                        params?: import("zod").JSONType | undefined;
                        timeoutMs?: number | undefined;
                    } | undefined;
                };
                readonly evidence: import("zod").JSONType;
            };
        };
    }[]>;
    rollback(sessionId: string, messages: MessageView[]): Promise<void>;
    filterMessages<Message extends MessageView>(sessionId: string, visible: MessageView[], messages: Message[], agentPreset?: string, queued?: boolean): Promise<Message[]>;
    close(): Promise<void>;
};
