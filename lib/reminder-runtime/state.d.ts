import { z } from 'zod';
import { ReminderRule, Source, compileRule } from './schema.js';
import { CapacitySettings, CapacityWire } from './capacity.js';
import type { ClaimBookValue } from './claims.js';
import type { HistoryView, MessageView } from './request-context.js';
import type { RecipientFacts, RecipientIdentity } from './scope.js';
import { type CountLimitValues } from './conditions.js';
import type { DenialVerdict, PreExecution, UnfinishedCode } from './denial.js';
export declare const Detector: z.ZodObject<{
    ref: z.ZodString;
    revision: z.ZodNumber;
    module: z.ZodString;
    exportName: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const Event: z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<{
        "tool.succeeded": "tool.succeeded";
        "tool.failed": "tool.failed";
        "request.before": "request.before";
        "assistant.output": "assistant.output";
        "tool.before-execute": "tool.before-execute";
        "session.event": "session.event";
    }>>;
    sessionId: z.ZodString;
    agentPreset: z.ZodOptional<z.ZodString>;
    callId: z.ZodString;
    rootCallId: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    arguments: z.ZodOptional<z.ZodJSONSchema>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    clock: z.ZodOptional<z.ZodObject<{
        at: z.ZodNumber;
        timeZone: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    native: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            "tool-result": "tool-result";
            "tool-call": "tool-call";
            "session-event": "session-event";
            "assistant-output": "assistant-output";
        }>;
        seq: z.ZodNumber;
    }, z.core.$strict>>;
    humanActivity: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        at: z.ZodNumber;
        evidence: z.ZodString;
    }, z.core.$strip>>>;
    output: z.ZodOptional<z.ZodObject<{
        attemptId: z.ZodString;
        turn: z.ZodNumber;
        step: z.ZodNumber;
        index: z.ZodNumber;
        type: z.ZodEnum<{
            text: "text";
            reasoning: "reasoning";
        }>;
        offset: z.ZodNumber;
        full: z.ZodDefault<z.ZodString>;
        text: z.ZodString;
    }, z.core.$strip>>;
    context: z.ZodOptional<z.ZodObject<{
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodString;
            text: z.ZodString;
            truncated: z.ZodBoolean;
        }, z.core.$strip>>;
        truncated: z.ZodBoolean;
    }, z.core.$strip>>;
    textSamples: z.ZodOptional<z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        sampleId: z.ZodString;
        window: z.ZodEnum<{
            "current-block": "current-block";
            "current-output": "current-output";
        }>;
        phase: z.ZodEnum<{
            complete: "complete";
            prefix: "prefix";
        }>;
        truncated: z.ZodBoolean;
    }, z.core.$strict>>>;
    origin: z.ZodDefault<z.ZodEnum<{
        tool: "tool";
        reminder: "reminder";
        human: "human";
        recovery: "recovery";
        background: "background";
    }>>;
    causationId: z.ZodOptional<z.ZodString>;
    facts: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
}, z.core.$catchall<z.ZodJSONSchema>>;
export declare const MatchResult: z.ZodObject<{
    ok: z.ZodBoolean;
    status: z.ZodOptional<z.ZodEnum<{
        matched: "matched";
        unmatched: "unmatched";
        unavailable: "unavailable";
    }>>;
}, z.core.$catchall<z.ZodJSONSchema>>;
/**
 * 一条规则的回执。它只保证「有这么一条」，不保证内容合法：
 * 合法性由消费层按单条契约判定——否则一条坏结果会把整批判废，与逐条时的行为不同。
 */
export declare const BatchAnswer: z.ZodUnion<readonly [z.ZodObject<{
    key: z.ZodString;
    ms: z.ZodNumber;
    match: z.ZodJSONSchema;
}, z.core.$strict>, z.ZodObject<{
    key: z.ZodString;
    ms: z.ZodNumber;
    error: z.ZodObject<{
        name: z.ZodString;
        message: z.ZodString;
    }, z.core.$catchall<z.ZodJSONSchema>>;
}, z.core.$strict>]>;
export type BatchAnswerValue = z.infer<typeof BatchAnswer>;
/**
 * worker 批量求值的收尾回执。`items` 故意收成 unknown[]：
 * 每一份回执单独过 BatchAnswer，一条坏掉只是那一条没答案。
 */
export declare const BatchResult: z.ZodObject<{
    items: z.ZodArray<z.ZodUnknown>;
    stopped: z.ZodBoolean;
    elapsedMs: z.ZodNumber;
}, z.core.$strict>;
export type BatchResultValue = z.infer<typeof BatchResult>;
export declare const AnalysisFacts: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
declare const Candidate: z.ZodObject<{
    id: z.ZodString;
    sessionId: z.ZodString;
    agentPreset: z.ZodOptional<z.ZodString>;
    sourceId: z.ZodString;
    sourceToken: z.ZodString;
    sourceSignature: z.ZodOptional<z.ZodString>;
    ruleId: z.ZodString;
    key: z.ZodString;
    window: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        start: z.ZodNumber;
        end: z.ZodNumber;
    }, z.core.$strip>>;
    request: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"request.before">;
        humanActivity: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            at: z.ZodNumber;
            evidence: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    revision: z.ZodNumber;
    policy: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
    text: z.ZodString;
    title: z.ZodString;
    eventId: z.ZodString;
    rootCallId: z.ZodString;
    native: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<{
            "tool-result": "tool-result";
            "tool-call": "tool-call";
            "session-event": "session-event";
            "assistant-output": "assistant-output";
        }>;
        seq: z.ZodNumber;
    }, z.core.$strict>>;
    output: z.ZodOptional<z.ZodObject<{
        attemptId: z.ZodString;
        turn: z.ZodNumber;
        step: z.ZodNumber;
        index: z.ZodNumber;
        type: z.ZodEnum<{
            text: "text";
            reasoning: "reasoning";
        }>;
        offset: z.ZodNumber;
        full: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        reserved: "reserved";
        pending: "pending";
        delivered: "delivered";
        discarded: "discarded";
    }>;
    messageId: z.ZodOptional<z.ZodString>;
    queued: z.ZodOptional<z.ZodLiteral<true>>;
    rendered: z.ZodOptional<z.ZodBoolean>;
    sticky: z.ZodOptional<z.ZodObject<{
        activationId: z.ZodString;
        charged: z.ZodBoolean;
    }, z.core.$strict>>;
    evidence: z.ZodJSONSchema;
    rule: z.ZodDiscriminatedUnion<[z.ZodObject<{
        format: z.ZodLiteral<"reminder/v4">;
        id: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        priority: z.ZodDefault<z.ZodNumber>;
        exclusiveGroup: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
            sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
            sessionIds?: string[] | undefined;
            agentPresets?: string[] | undefined;
            condition?: z.core.util.JSONType | undefined;
        }>>>;
        text: z.ZodString;
        judge: z.ZodOptional<z.ZodObject<{
            ref: z.ZodString;
            revision: z.ZodNumber;
            params: z.ZodOptional<z.ZodJSONSchema>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        on: z.ZodLiteral<"tool.succeeded">;
        when: z.ZodObject<{
            tool: z.ZodString;
            arguments: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
                regex: z.ZodString;
                flags: z.ZodDefault<z.ZodString>;
            }, z.core.$strict>>>;
            error: z.ZodOptional<z.ZodObject<{
                code: z.ZodString;
            }, z.core.$strict>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>;
        effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"remind">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"deny-tool">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
            dangerous: z.ZodLiteral<true>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>, z.ZodObject<{
        format: z.ZodLiteral<"reminder/v4">;
        id: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        priority: z.ZodDefault<z.ZodNumber>;
        exclusiveGroup: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
            sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
            sessionIds?: string[] | undefined;
            agentPresets?: string[] | undefined;
            condition?: z.core.util.JSONType | undefined;
        }>>>;
        text: z.ZodString;
        judge: z.ZodOptional<z.ZodObject<{
            ref: z.ZodString;
            revision: z.ZodNumber;
            params: z.ZodOptional<z.ZodJSONSchema>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        on: z.ZodLiteral<"tool.failed">;
        when: z.ZodObject<{
            tool: z.ZodString;
            arguments: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
                regex: z.ZodString;
                flags: z.ZodDefault<z.ZodString>;
            }, z.core.$strict>>>;
            error: z.ZodOptional<z.ZodObject<{
                code: z.ZodString;
            }, z.core.$strict>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>;
        effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"remind">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"deny-tool">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
            dangerous: z.ZodLiteral<true>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>, z.ZodObject<{
        format: z.ZodLiteral<"reminder/v4">;
        id: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        priority: z.ZodDefault<z.ZodNumber>;
        exclusiveGroup: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
            sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
            sessionIds?: string[] | undefined;
            agentPresets?: string[] | undefined;
            condition?: z.core.util.JSONType | undefined;
        }>>>;
        text: z.ZodString;
        judge: z.ZodOptional<z.ZodObject<{
            ref: z.ZodString;
            revision: z.ZodNumber;
            params: z.ZodOptional<z.ZodJSONSchema>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        on: z.ZodLiteral<"request.before">;
        when: z.ZodObject<{
            timeWindow: z.ZodOptional<z.ZodObject<{
                start: z.ZodString;
                end: z.ZodString;
                timeZone: z.ZodDefault<z.ZodLiteral<"local">>;
            }, z.core.$strict>>;
            humanActivity: z.ZodOptional<z.ZodObject<{
                withinSeconds: z.ZodNumber;
            }, z.core.$strict>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>;
        effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"remind">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"deny-tool">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
            dangerous: z.ZodLiteral<true>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>, z.ZodObject<{
        format: z.ZodLiteral<"reminder/v4">;
        id: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        priority: z.ZodDefault<z.ZodNumber>;
        exclusiveGroup: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
            sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
            sessionIds?: string[] | undefined;
            agentPresets?: string[] | undefined;
            condition?: z.core.util.JSONType | undefined;
        }>>>;
        text: z.ZodString;
        judge: z.ZodOptional<z.ZodObject<{
            ref: z.ZodString;
            revision: z.ZodNumber;
            params: z.ZodOptional<z.ZodJSONSchema>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        on: z.ZodLiteral<"assistant.output">;
        when: z.ZodObject<{
            blockTypes: z.ZodArray<z.ZodEnum<{
                text: "text";
                reasoning: "reasoning";
            }>>;
            pattern: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"literal">;
                text: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"keywords">;
                values: z.ZodArray<z.ZodString>;
                mode: z.ZodDefault<z.ZodEnum<{
                    any: "any";
                    all: "all";
                }>>;
            }, z.core.$strict>, z.ZodObject<{
                regex: z.ZodString;
                flags: z.ZodDefault<z.ZodString>;
                kind: z.ZodLiteral<"regex">;
            }, z.core.$strict>], "kind">;
            timeWindow: z.ZodOptional<z.ZodObject<{
                start: z.ZodString;
                end: z.ZodString;
                timeZone: z.ZodDefault<z.ZodLiteral<"local">>;
            }, z.core.$strict>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>;
        effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"remind">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"deny-tool">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
            dangerous: z.ZodLiteral<true>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>, z.ZodObject<{
        format: z.ZodLiteral<"reminder/v4">;
        id: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        priority: z.ZodDefault<z.ZodNumber>;
        exclusiveGroup: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
            sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
            sessionIds?: string[] | undefined;
            agentPresets?: string[] | undefined;
            condition?: z.core.util.JSONType | undefined;
        }>>>;
        text: z.ZodString;
        judge: z.ZodOptional<z.ZodObject<{
            ref: z.ZodString;
            revision: z.ZodNumber;
            params: z.ZodOptional<z.ZodJSONSchema>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        on: z.ZodLiteral<"tool.before-execute">;
        when: z.ZodObject<{
            tool: z.ZodString;
            arguments: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
                regex: z.ZodString;
                flags: z.ZodDefault<z.ZodString>;
            }, z.core.$strict>>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>;
        effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"remind">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"deny-tool">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
            dangerous: z.ZodLiteral<true>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>, z.ZodObject<{
        format: z.ZodLiteral<"reminder/v4">;
        id: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        priority: z.ZodDefault<z.ZodNumber>;
        exclusiveGroup: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
            sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
            sessionIds?: string[] | undefined;
            agentPresets?: string[] | undefined;
            condition?: z.core.util.JSONType | undefined;
        }>>>;
        text: z.ZodString;
        judge: z.ZodOptional<z.ZodObject<{
            ref: z.ZodString;
            revision: z.ZodNumber;
            params: z.ZodOptional<z.ZodJSONSchema>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        on: z.ZodLiteral<"session.event">;
        when: z.ZodObject<{
            eventType: z.ZodString;
            condition: z.ZodOptional<z.ZodJSONSchema>;
        }, z.core.$strict>;
        effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"remind">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"deny-tool">;
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
                        none: "none";
                        surface: "surface";
                    }>;
                    shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>, z.ZodObject<{
                        reset: z.ZodLiteral<"window">;
                        limit: z.ZodNumber;
                    }, z.core.$strict>], "reset">>;
                    interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                    sticky: z.ZodOptional<z.ZodObject<{
                        lifetime: z.ZodNumber;
                        cooldown: z.ZodNumber;
                        clock: z.ZodDefault<z.ZodEnum<{
                            "main-request": "main-request";
                            "human-turn": "human-turn";
                        }>>;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
            dangerous: z.ZodLiteral<true>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>], "on">;
}, z.core.$strip>;
/**
 * One sticky activation: a reminder that stays present across consecutive clock
 * ticks. `remaining` counts the active ticks left after the delivering tick, and
 * `cooldown` counts the silent ticks that follow before a new event may activate it.
 */
declare const StickyState: z.ZodObject<{
    key: z.ZodString;
    activationId: z.ZodString;
    sourceId: z.ZodString;
    ruleId: z.ZodString;
    sessionId: z.ZodString;
    text: z.ZodString;
    title: z.ZodString;
    clock: z.ZodEnum<{
        "main-request": "main-request";
        "human-turn": "human-turn";
    }>;
    remaining: z.ZodNumber;
    cooldown: z.ZodNumber;
    charged: z.ZodBoolean;
    lastHumanId: z.ZodString;
}, z.core.$strict>;
export declare const SessionState: z.ZodObject<{
    seen: z.ZodArray<z.ZodString>;
    candidates: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        sessionId: z.ZodString;
        agentPreset: z.ZodOptional<z.ZodString>;
        sourceId: z.ZodString;
        sourceToken: z.ZodString;
        sourceSignature: z.ZodOptional<z.ZodString>;
        ruleId: z.ZodString;
        key: z.ZodString;
        window: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strip>>;
        request: z.ZodOptional<z.ZodObject<{
            type: z.ZodLiteral<"request.before">;
            humanActivity: z.ZodOptional<z.ZodNullable<z.ZodObject<{
                at: z.ZodNumber;
                evidence: z.ZodString;
            }, z.core.$strip>>>;
        }, z.core.$strip>>;
        revision: z.ZodNumber;
        policy: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
        text: z.ZodString;
        title: z.ZodString;
        eventId: z.ZodString;
        rootCallId: z.ZodString;
        native: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<{
                "tool-result": "tool-result";
                "tool-call": "tool-call";
                "session-event": "session-event";
                "assistant-output": "assistant-output";
            }>;
            seq: z.ZodNumber;
        }, z.core.$strict>>;
        output: z.ZodOptional<z.ZodObject<{
            attemptId: z.ZodString;
            turn: z.ZodNumber;
            step: z.ZodNumber;
            index: z.ZodNumber;
            type: z.ZodEnum<{
                text: "text";
                reasoning: "reasoning";
            }>;
            offset: z.ZodNumber;
            full: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            reserved: "reserved";
            pending: "pending";
            delivered: "delivered";
            discarded: "discarded";
        }>;
        messageId: z.ZodOptional<z.ZodString>;
        queued: z.ZodOptional<z.ZodLiteral<true>>;
        rendered: z.ZodOptional<z.ZodBoolean>;
        sticky: z.ZodOptional<z.ZodObject<{
            activationId: z.ZodString;
            charged: z.ZodBoolean;
        }, z.core.$strict>>;
        evidence: z.ZodJSONSchema;
        rule: z.ZodDiscriminatedUnion<[z.ZodObject<{
            format: z.ZodLiteral<"reminder/v4">;
            id: z.ZodString;
            title: z.ZodOptional<z.ZodString>;
            priority: z.ZodDefault<z.ZodNumber>;
            exclusiveGroup: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
                sessionIds?: string[] | undefined;
                agentPresets?: string[] | undefined;
                condition?: z.core.util.JSONType | undefined;
            }>>>;
            text: z.ZodString;
            judge: z.ZodOptional<z.ZodObject<{
                ref: z.ZodString;
                revision: z.ZodNumber;
                params: z.ZodOptional<z.ZodJSONSchema>;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            on: z.ZodLiteral<"tool.succeeded">;
            when: z.ZodObject<{
                tool: z.ZodString;
                arguments: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
                    regex: z.ZodString;
                    flags: z.ZodDefault<z.ZodString>;
                }, z.core.$strict>>>;
                error: z.ZodOptional<z.ZodObject<{
                    code: z.ZodString;
                }, z.core.$strict>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>;
            effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"remind">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"deny-tool">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
                dangerous: z.ZodLiteral<true>;
                reason: z.ZodString;
            }, z.core.$strict>], "kind">;
        }, z.core.$strict>, z.ZodObject<{
            format: z.ZodLiteral<"reminder/v4">;
            id: z.ZodString;
            title: z.ZodOptional<z.ZodString>;
            priority: z.ZodDefault<z.ZodNumber>;
            exclusiveGroup: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
                sessionIds?: string[] | undefined;
                agentPresets?: string[] | undefined;
                condition?: z.core.util.JSONType | undefined;
            }>>>;
            text: z.ZodString;
            judge: z.ZodOptional<z.ZodObject<{
                ref: z.ZodString;
                revision: z.ZodNumber;
                params: z.ZodOptional<z.ZodJSONSchema>;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            on: z.ZodLiteral<"tool.failed">;
            when: z.ZodObject<{
                tool: z.ZodString;
                arguments: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
                    regex: z.ZodString;
                    flags: z.ZodDefault<z.ZodString>;
                }, z.core.$strict>>>;
                error: z.ZodOptional<z.ZodObject<{
                    code: z.ZodString;
                }, z.core.$strict>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>;
            effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"remind">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"deny-tool">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
                dangerous: z.ZodLiteral<true>;
                reason: z.ZodString;
            }, z.core.$strict>], "kind">;
        }, z.core.$strict>, z.ZodObject<{
            format: z.ZodLiteral<"reminder/v4">;
            id: z.ZodString;
            title: z.ZodOptional<z.ZodString>;
            priority: z.ZodDefault<z.ZodNumber>;
            exclusiveGroup: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
                sessionIds?: string[] | undefined;
                agentPresets?: string[] | undefined;
                condition?: z.core.util.JSONType | undefined;
            }>>>;
            text: z.ZodString;
            judge: z.ZodOptional<z.ZodObject<{
                ref: z.ZodString;
                revision: z.ZodNumber;
                params: z.ZodOptional<z.ZodJSONSchema>;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            on: z.ZodLiteral<"request.before">;
            when: z.ZodObject<{
                timeWindow: z.ZodOptional<z.ZodObject<{
                    start: z.ZodString;
                    end: z.ZodString;
                    timeZone: z.ZodDefault<z.ZodLiteral<"local">>;
                }, z.core.$strict>>;
                humanActivity: z.ZodOptional<z.ZodObject<{
                    withinSeconds: z.ZodNumber;
                }, z.core.$strict>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>;
            effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"remind">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"deny-tool">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
                dangerous: z.ZodLiteral<true>;
                reason: z.ZodString;
            }, z.core.$strict>], "kind">;
        }, z.core.$strict>, z.ZodObject<{
            format: z.ZodLiteral<"reminder/v4">;
            id: z.ZodString;
            title: z.ZodOptional<z.ZodString>;
            priority: z.ZodDefault<z.ZodNumber>;
            exclusiveGroup: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
                sessionIds?: string[] | undefined;
                agentPresets?: string[] | undefined;
                condition?: z.core.util.JSONType | undefined;
            }>>>;
            text: z.ZodString;
            judge: z.ZodOptional<z.ZodObject<{
                ref: z.ZodString;
                revision: z.ZodNumber;
                params: z.ZodOptional<z.ZodJSONSchema>;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            on: z.ZodLiteral<"assistant.output">;
            when: z.ZodObject<{
                blockTypes: z.ZodArray<z.ZodEnum<{
                    text: "text";
                    reasoning: "reasoning";
                }>>;
                pattern: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"literal">;
                    text: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"keywords">;
                    values: z.ZodArray<z.ZodString>;
                    mode: z.ZodDefault<z.ZodEnum<{
                        any: "any";
                        all: "all";
                    }>>;
                }, z.core.$strict>, z.ZodObject<{
                    regex: z.ZodString;
                    flags: z.ZodDefault<z.ZodString>;
                    kind: z.ZodLiteral<"regex">;
                }, z.core.$strict>], "kind">;
                timeWindow: z.ZodOptional<z.ZodObject<{
                    start: z.ZodString;
                    end: z.ZodString;
                    timeZone: z.ZodDefault<z.ZodLiteral<"local">>;
                }, z.core.$strict>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>;
            effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"remind">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"deny-tool">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
                dangerous: z.ZodLiteral<true>;
                reason: z.ZodString;
            }, z.core.$strict>], "kind">;
        }, z.core.$strict>, z.ZodObject<{
            format: z.ZodLiteral<"reminder/v4">;
            id: z.ZodString;
            title: z.ZodOptional<z.ZodString>;
            priority: z.ZodDefault<z.ZodNumber>;
            exclusiveGroup: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
                sessionIds?: string[] | undefined;
                agentPresets?: string[] | undefined;
                condition?: z.core.util.JSONType | undefined;
            }>>>;
            text: z.ZodString;
            judge: z.ZodOptional<z.ZodObject<{
                ref: z.ZodString;
                revision: z.ZodNumber;
                params: z.ZodOptional<z.ZodJSONSchema>;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            on: z.ZodLiteral<"tool.before-execute">;
            when: z.ZodObject<{
                tool: z.ZodString;
                arguments: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
                    regex: z.ZodString;
                    flags: z.ZodDefault<z.ZodString>;
                }, z.core.$strict>>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>;
            effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"remind">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"deny-tool">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
                dangerous: z.ZodLiteral<true>;
                reason: z.ZodString;
            }, z.core.$strict>], "kind">;
        }, z.core.$strict>, z.ZodObject<{
            format: z.ZodLiteral<"reminder/v4">;
            id: z.ZodString;
            title: z.ZodOptional<z.ZodString>;
            priority: z.ZodDefault<z.ZodNumber>;
            exclusiveGroup: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
                sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
                agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
                sessionIds?: string[] | undefined;
                agentPresets?: string[] | undefined;
                condition?: z.core.util.JSONType | undefined;
            }>>>;
            text: z.ZodString;
            judge: z.ZodOptional<z.ZodObject<{
                ref: z.ZodString;
                revision: z.ZodNumber;
                params: z.ZodOptional<z.ZodJSONSchema>;
                timeoutMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            on: z.ZodLiteral<"session.event">;
            when: z.ZodObject<{
                eventType: z.ZodString;
                condition: z.ZodOptional<z.ZodJSONSchema>;
            }, z.core.$strict>;
            effect: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"remind">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"deny-tool">;
                deliver: z.ZodObject<{
                    model: z.ZodObject<{
                        once: z.ZodEnum<{
                            window: "window";
                            none: "none";
                            surface: "surface";
                        }>;
                        shared: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
                            reset: z.ZodLiteral<"lifetime">;
                            lifetime: z.ZodString;
                            limit: z.ZodNumber;
                        }, z.core.$strict>, z.ZodObject<{
                            reset: z.ZodLiteral<"window">;
                            limit: z.ZodNumber;
                        }, z.core.$strict>], "reset">>;
                        interrupt: z.ZodOptional<z.ZodLiteral<"abort-resume">>;
                        sticky: z.ZodOptional<z.ZodObject<{
                            lifetime: z.ZodNumber;
                            cooldown: z.ZodNumber;
                            clock: z.ZodDefault<z.ZodEnum<{
                                "main-request": "main-request";
                                "human-turn": "human-turn";
                            }>>;
                        }, z.core.$strict>>;
                    }, z.core.$strict>;
                }, z.core.$strict>;
                dangerous: z.ZodLiteral<true>;
                reason: z.ZodString;
            }, z.core.$strict>], "kind">;
        }, z.core.$strict>], "on">;
    }, z.core.$strip>>;
    diagnostics: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    windows: z.ZodDefault<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        until: z.ZodNumber;
        messageId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    stickies: z.ZodDefault<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        activationId: z.ZodString;
        sourceId: z.ZodString;
        ruleId: z.ZodString;
        sessionId: z.ZodString;
        text: z.ZodString;
        title: z.ZodString;
        clock: z.ZodEnum<{
            "main-request": "main-request";
            "human-turn": "human-turn";
        }>;
        remaining: z.ZodNumber;
        cooldown: z.ZodNumber;
        charged: z.ZodBoolean;
        lastHumanId: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const REMINDER_DOMAIN: {
    name: string;
    version: number;
    layout: "per-record";
    tables: {
        sessions: {
            valueSchema: z.ZodObject<{
                seen: z.ZodArray<z.ZodString>;
                candidates: z.ZodArray<z.ZodJSONSchema>;
                diagnostics: z.ZodArray<z.ZodJSONSchema>;
                windows: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    until: z.ZodNumber;
                    messageId: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>>;
                stickies: z.ZodOptional<z.ZodArray<z.ZodJSONSchema>>;
            }, z.core.$strict>;
        };
    };
};
export type CandidateValue = z.infer<typeof Candidate>;
export type StickyStateValue = z.infer<typeof StickyState>;
export type StateValue = z.infer<typeof SessionState>;
export type EventValue = z.infer<typeof Event>;
export type SourceValue = z.infer<typeof Source>;
export type RuleValue = z.infer<typeof ReminderRule>;
export type DetectorValue = z.infer<typeof Detector>;
export type CompiledRule = ReturnType<typeof compileRule>;
export type Rejection = z.infer<typeof CapacityWire>['rejections'][number];
export interface RegisteredSource {
    owner: object;
    acceptSession: (sessionId: string) => boolean;
    token: string;
    value: SourceValue;
    compiled: CompiledRule[];
}
export interface WorkItem {
    source: SourceValue;
    token: string;
    rule: CompiledRule;
    policy: CandidateValue['policy'];
    judge?: DetectorValue;
    window?: CandidateValue['window'];
    /** Re-evaluate a choice as an exclusivity barrier without delivering this handed rule again. */
    handed?: boolean;
    /** An alias withdrawn or rebound during Worker evaluation cannot publish its old match. */
    nativeEvent?: string;
}
export interface Run {
    event: EventValue;
    items: WorkItem[];
    analyzers: DetectorValue[];
    /** Authoritative current recipient read once for this ordered historical scan. */
    recipient?: RecipientIdentity;
    controller: AbortController;
    /** Remaining time measured inside workers; queue and storage time never debit it. */
    remainingMs: number;
    resolve: () => void;
    done: Promise<void>;
    task?: Promise<unknown>;
    /** A completed match must not report successful acceptance when its native inbox publication failed. */
    handoffFailure?: Error;
    /** The call this round decides, for pre-execution rounds only. */
    preExecution?: PreExecution;
    /** Denial chosen by this round; absent means the call stays allowed. */
    denial?: DenialVerdict;
    /** Whether every rule was actually evaluated; an interrupted round must not authorize. */
    evaluated?: boolean;
    /**
     * 这一轮是从哪一步失去确定答案的（规则超时、失败、整轮超时、取消……）。
     * 完成度是逐规则记账的离散事实：只要有一条没有结论，整轮就不算完成，
     * 不能因为“整体耗时在预算内”就当作评估过了。有值即代表这一轮不完整。
     */
    incomplete?: UnfinishedCode;
}
/** A compiled rule plus its independent execution allowance and ordered group policy. */
export interface BatchRuleInput {
    key: string;
    condition: CompiledRule['condition'];
    judge?: DetectorValue;
    params?: z.infer<ReturnType<typeof z.json>>;
    timeoutMs?: number;
    exclusiveGroup?: string;
    error?: {
        name: string;
        message: string;
    };
}
/** Compiled conditions retain count limits at the worker validation boundary. */
export type Work = {
    analysis: {
        analyzer: DetectorValue;
        event: EventValue;
        maxBytes: number;
    };
} | {
    reminder: {
        condition: CompiledRule['condition'];
        event: EventValue;
        maxBytes: number;
        countLimits: CountLimitValues;
        judge?: DetectorValue;
        params?: z.infer<ReturnType<typeof z.json>>;
    };
}
/**
 * 一次往返算完多条规则。逐条往返的固定开销按规则数线性增长，
 * 而单条规则真正的匹配只有几十微秒，所以往返次数本身才是瓶颈。
 */
 | {
    reminderBatch: {
        event: EventValue;
        maxBytes: number;
        countLimits: CountLimitValues;
        budgetMs?: number;
        blockedGroups?: string[];
        rules: BatchRuleInput[];
    };
};
export interface HandoffRule {
    sourceId: string;
    ruleId: string;
    exclusiveGroup?: string;
    output?: Pick<NonNullable<EventValue['output']>, 'attemptId' | 'turn' | 'step'>;
}
export interface OutputHandoffRule extends HandoffRule {
    output: NonNullable<HandoffRule['output']>;
}
export type HandoffLookup = (triggerId: string, rule?: HandoffRule) => boolean;
export interface RuntimeOptions {
    config?: unknown;
    entries?: Iterable<readonly [string, unknown]>;
    /** Keep candidate/evaluation state process-local; Session inbox and event logs own recovery. */
    sessionAuthoritative?: boolean;
    /** Strict, single-pass prompt templates reused from context-care's engine. */
    templates?: TemplateRenderer;
    save?: (id: string, state: StateValue) => Promise<unknown> | void;
    /**
     * 执行端口。`onItem` 只对批量工作有意义：worker 每算完一条就上报一条，
     * 这样即使这一批因为超时被终止，已经算完的规则也不会跟着蒸发。
     */
    execute?: (input: Work, signal: AbortSignal, timing: {
        onDispatch: () => void;
        workTimeoutMs: number;
        onItem?: (answer: unknown) => void;
        onTiming?: (timing: {
            processingMs: number;
        }) => void;
    }) => Promise<unknown>;
    capacity?: unknown;
    saveCapacity?: (value: z.infer<typeof CapacitySettings>) => Promise<unknown> | void;
    /** Notify observers only after the owning catalog or settings actually change. */
    changed?: (sessionId?: string) => void;
    dispatches?: boolean;
    resolvePreset?: (sessionId: string) => string | undefined;
    /** Authoritative current session facts; supplied event metadata is ignored when present. */
    resolveIdentity?: (sessionId: string, signal?: AbortSignal) => RecipientFacts | Promise<RecipientFacts>;
    /** Reconstruct an anchored trigger from native facts before admission or evaluation. */
    resolveEvent?: (event: EventValue, signal?: AbortSignal) => Promise<EventValue>;
    /** Native triggers preceding an explicit policy reset cannot activate that rule again. */
    sinceSeq?: (sessionId: string, sourceId: string, ruleId: string) => number;
    updateClaims?: (change: (book: ClaimBookValue) => ClaimBookValue) => Promise<ClaimBookValue>;
    /** Committed windows and sticky clocks reconstructed from the owning Session. */
    readDeliveries?: (sessionId: string, humanId: string, fromSeq?: number) => Promise<import('./session-deliveries.js').DeliveryState>;
    /** Whether native inbox/message evidence accepted this rule's trigger or exclusive choice. */
    wasHanded?: (sessionId: string, triggerId: string, rule?: HandoffRule, fromSeq?: number) => Promise<boolean>;
    /** Accepted but uncommitted native inbox messages; never evaluates historical triggers. */
    readQueued?: (sessionId: string) => readonly MessageView[];
    /** Store an otherwise unlogged match as ordinary pending context without waking the Agent. */
    handoffPending?: (sessionId: string, candidateIds: readonly string[]) => Promise<void>;
    wallNow?: () => number;
    now?: () => number;
    eligible?: (sessionId: string, sourceId: string, ruleId: string) => boolean;
    epoch?: (sessionId: string, sourceId: string, ruleId: string) => CandidateValue['policy'];
    report?: (error: unknown) => void;
}
/** The subset of the shared template engine the runtime needs. */
export interface TemplateRenderer {
    /** Reject an unusable template before any rule is registered. */
    validate(source: string): void;
    /**
     * Render once against a frozen snapshot. The argument is `unknown` because the
     * engine owns snapshot validation: it walks the value and rejects anything that
     * is not plain JSON, so the caller does not pre-narrow it here.
     */
    render(source: string, snapshot: unknown): string;
}
/** One tool call at the pre-execution point, already materialized by the registry. */
export interface ToolPreparation {
    /** Registry execution token; the later synchronous guard correlates on this exact object. */
    key: object;
    sessionId: string;
    agentPreset?: string;
    name: string;
    arguments: unknown;
    callId: string;
    rootCallId: string;
    native?: {
        type: 'tool-call';
        seq: number;
    };
    signal?: AbortSignal;
}
export interface RequestInput {
    sessionId: string;
    agentPreset?: string;
    events: HistoryView;
    visible?: readonly MessageView[];
    accepted?: MessageView[];
    signal?: AbortSignal;
}
export interface CollectInput {
    sessionId: string;
    agentPreset?: string;
    visible: readonly MessageView[];
    accepted?: MessageView[];
    committedIds?: string[];
    candidateIds?: string[];
    signal?: AbortSignal;
}
/** Distinct trigger phases share real call ids; deduplication must keep those facts separate. */
export declare function triggerKey(type: string | undefined, callId: string): string;
/** JSON transport copying is intentional: optional undefined fields do not enter durable records. */
export declare function jsonCopy(value: unknown): unknown;
export declare function errorMessage(error: unknown): string;
export declare function errorDetail(error: unknown): {
    diagnostic?: undefined;
} | {
    diagnostic: z.core.util.JSONType;
};
export {};
