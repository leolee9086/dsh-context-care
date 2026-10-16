import type { MessageId } from '@deepseek-ai/dsh-llm';
import { Source } from './schema.js';
import type { MessageView } from './request-context.js';
import type { RecipientIdentity } from './scope.js';
import type { CandidateValue, RuntimeOptions, RequestInput, CollectInput } from './state.js';
export { ReminderConfig } from './schema.js';
export { REMINDER_DOMAIN } from './state.js';
export type { RuntimeOptions } from './state.js';
/** Public source declarations keep schema defaults optional until registration. */
export type ReminderSource = import('zod').input<typeof Source>;
export type ReminderRuleInput = ReminderSource['rules'][number];
/** Consumers take only the methods they need from the actual runtime factory. */
export type ReminderService = ReturnType<typeof createReminderRuntime>;
export type ReminderSourceHandle = ReturnType<ReminderService['registerSource']>;
export declare const REMINDER_SERVICE = "reminderRules";
declare function reminderSource(candidate: CandidateValue): {
    readonly kind: "plugin:dsh-context-care:reminder";
    readonly form: "notice";
    readonly summary: string;
    readonly reminder: {
        readonly key: string;
        readonly candidateId: string;
    };
    readonly contextCareTrace: {
        readonly output?: {
            attemptId: string;
            turn: number;
            step: number;
            index: number;
            type: "text" | "reasoning";
            offset: number;
        } | undefined;
        readonly trigger: "reminder-rule";
        readonly evaluationId: string;
        readonly ruleId: string;
        readonly sourceId: string;
        readonly callId: string;
        readonly rule: {
            format: "reminder/v1";
            id: string;
            priority: number;
            text: string;
            deliver: {
                model: {
                    once: "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | undefined;
                };
            };
            on: "tool.succeeded" | "tool.failed";
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
            id: string;
            priority: number;
            text: string;
            format: "reminder/v2";
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
            deliver: {
                model: {
                    once: "window" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                };
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
            id: string;
            priority: number;
            text: string;
            format: "reminder/v3";
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
            deliver: {
                model: {
                    once: "window" | "surface";
                    shared?: {
                        reset: "lifetime";
                        lifetime: string;
                        limit: number;
                    } | {
                        reset: "window";
                        limit: number;
                    } | undefined;
                    interrupt?: "abort-resume" | undefined;
                };
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
/** One runtime owns source snapshots, evaluation lifetimes and durable candidate records.
 * save ACKs before publishing state; execute must settle cancellation after its worker stops.
 * No Cordis or live session objects enter the scheduler. */
export declare function createReminderRuntime({ config: input, entries, save, execute, capacity, saveCapacity, dispatches, resolvePreset, updateClaims, wallNow, now, eligible, epoch, report }?: RuntimeOptions): {
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
    /** Persist suppression through the active calendar window; omitted identity selects all window rules. */
    snooze({ sessionId, agentPreset, sourceId, ruleId }: RecipientIdentity & {
        sourceId?: string;
        ruleId?: string;
    }): Promise<{
        sourceId: string;
        ruleId: string;
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
        condition: import("zod").JSONType;
        format: "reminder/v1";
        id: string;
        priority: number;
        text: string;
        deliver: {
            model: {
                once: "surface";
                shared?: {
                    reset: "lifetime";
                    lifetime: string;
                    limit: number;
                } | undefined;
            };
        };
        on: "tool.succeeded" | "tool.failed";
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
        condition: import("zod").JSONType;
        id: string;
        priority: number;
        text: string;
        format: "reminder/v2";
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
        deliver: {
            model: {
                once: "window" | "surface";
                shared?: {
                    reset: "lifetime";
                    lifetime: string;
                    limit: number;
                } | {
                    reset: "window";
                    limit: number;
                } | undefined;
            };
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
        condition: import("zod").JSONType;
        id: string;
        priority: number;
        text: string;
        format: "reminder/v3";
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
        deliver: {
            model: {
                once: "window" | "surface";
                shared?: {
                    reset: "lifetime";
                    lifetime: string;
                    limit: number;
                } | {
                    reset: "window";
                    limit: number;
                } | undefined;
                interrupt?: "abort-resume" | undefined;
            };
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
    catalog(sessionId: string, agentPreset?: string): {
        readOnly: boolean;
        rules: {
            id: string;
            title: string;
            description: string;
            definition: {
                format: "reminder/v1";
                id: string;
                priority: number;
                text: string;
                deliver: {
                    model: {
                        once: "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | undefined;
                    };
                };
                on: "tool.succeeded" | "tool.failed";
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
                id: string;
                priority: number;
                text: string;
                format: "reminder/v2";
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
                deliver: {
                    model: {
                        once: "window" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                    };
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
                id: string;
                priority: number;
                text: string;
                format: "reminder/v3";
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
                deliver: {
                    model: {
                        once: "window" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                    };
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
    settle(sessionId: string): Promise<void>;
    snapshot(sessionId: string): {
        sources: {
            sourceId: string;
            plugin: string;
            revision: number;
            rules: ({
                format: "reminder/v1";
                id: string;
                priority: number;
                text: string;
                deliver: {
                    model: {
                        once: "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | undefined;
                    };
                };
                on: "tool.succeeded" | "tool.failed";
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
                id: string;
                priority: number;
                text: string;
                format: "reminder/v2";
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
                deliver: {
                    model: {
                        once: "window" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                    };
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
                id: string;
                priority: number;
                text: string;
                format: "reminder/v3";
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
                deliver: {
                    model: {
                        once: "window" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                    };
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
                format: "reminder/v1";
                id: string;
                priority: number;
                text: string;
                deliver: {
                    model: {
                        once: "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | undefined;
                    };
                };
                on: "tool.succeeded" | "tool.failed";
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
                id: string;
                priority: number;
                text: string;
                format: "reminder/v2";
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
                deliver: {
                    model: {
                        once: "window" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                    };
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
                id: string;
                priority: number;
                text: string;
                format: "reminder/v3";
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
                deliver: {
                    model: {
                        once: "window" | "surface";
                        shared?: {
                            reset: "lifetime";
                            lifetime: string;
                            limit: number;
                        } | {
                            reset: "window";
                            limit: number;
                        } | undefined;
                        interrupt?: "abort-resume" | undefined;
                    };
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
            output?: {
                attemptId: string;
                turn: number;
                step: number;
                index: number;
                type: "text" | "reasoning";
                offset: number;
            } | undefined;
            messageId?: string | undefined;
        }[];
        diagnostics: Record<string, import("zod").JSONType>[];
        windows: {
            key: string;
            until: number;
            messageId?: string | undefined;
        }[];
    };
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
                readonly key: string;
                readonly candidateId: string;
            };
            readonly contextCareTrace: {
                readonly output?: {
                    attemptId: string;
                    turn: number;
                    step: number;
                    index: number;
                    type: "text" | "reasoning";
                    offset: number;
                } | undefined;
                readonly trigger: "reminder-rule";
                readonly evaluationId: string;
                readonly ruleId: string;
                readonly sourceId: string;
                readonly callId: string;
                readonly rule: {
                    format: "reminder/v1";
                    id: string;
                    priority: number;
                    text: string;
                    deliver: {
                        model: {
                            once: "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | undefined;
                        };
                    };
                    on: "tool.succeeded" | "tool.failed";
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
                    id: string;
                    priority: number;
                    text: string;
                    format: "reminder/v2";
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
                    deliver: {
                        model: {
                            once: "window" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                        };
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
                    id: string;
                    priority: number;
                    text: string;
                    format: "reminder/v3";
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
                    deliver: {
                        model: {
                            once: "window" | "surface";
                            shared?: {
                                reset: "lifetime";
                                lifetime: string;
                                limit: number;
                            } | {
                                reset: "window";
                                limit: number;
                            } | undefined;
                            interrupt?: "abort-resume" | undefined;
                        };
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
    filterMessages<Message extends MessageView>(sessionId: string, visible: MessageView[], messages: Message[], agentPreset?: string): Message[];
    close(): Promise<void>;
};
