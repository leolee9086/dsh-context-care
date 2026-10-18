import { z } from 'zod';
import { ReminderRule, Source, compileRule } from './schema.js';
import { CapacitySettings, CapacityWire } from './capacity.js';
import type { ClaimBookValue } from './claims.js';
import type { HistoryEvent, MessageView } from './request-context.js';
import type { RecipientFacts } from './scope.js';
import { type CountLimitValues } from './conditions.js';
import type { DenialVerdict } from './denial.js';
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
        human: "human";
        reminder: "reminder";
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
            reason: z.ZodOptional<z.ZodString>;
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
            reason: z.ZodOptional<z.ZodString>;
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
            reason: z.ZodOptional<z.ZodString>;
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
            reason: z.ZodOptional<z.ZodString>;
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
            reason: z.ZodOptional<z.ZodString>;
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
            reason: z.ZodOptional<z.ZodString>;
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
                reason: z.ZodOptional<z.ZodString>;
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
                reason: z.ZodOptional<z.ZodString>;
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
                reason: z.ZodOptional<z.ZodString>;
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
                reason: z.ZodOptional<z.ZodString>;
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
                reason: z.ZodOptional<z.ZodString>;
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
                reason: z.ZodOptional<z.ZodString>;
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
}
export interface Run {
    event: EventValue;
    items: WorkItem[];
    analyzers: DetectorValue[];
    controller: AbortController;
    deadline: number;
    resolve: () => void;
    done: Promise<void>;
    task?: Promise<unknown>;
    timer?: ReturnType<typeof setTimeout>;
    /** Execution token this round decides, for pre-execution calls only. */
    denialKey?: object;
    /** Denial chosen by this round; absent means the call stays allowed. */
    denial?: DenialVerdict;
    /** Whether every rule was actually evaluated; an interrupted round must not authorize. */
    evaluated?: boolean;
}
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
};
export interface RuntimeOptions {
    config?: unknown;
    entries?: Iterable<readonly [string, unknown]>;
    /** Strict, single-pass prompt templates reused from context-care's engine. */
    templates?: TemplateRenderer;
    save?: (id: string, state: StateValue) => Promise<unknown> | void;
    execute?: (input: Work, signal: AbortSignal, timing: {
        onDispatch: () => void;
        workTimeoutMs: number;
    }) => Promise<unknown>;
    capacity?: unknown;
    saveCapacity?: (value: z.infer<typeof CapacitySettings>) => Promise<unknown> | void;
    dispatches?: boolean;
    resolvePreset?: (sessionId: string) => string | undefined;
    /** Authoritative current session facts; supplied event metadata is ignored when present. */
    resolveIdentity?: (sessionId: string, signal?: AbortSignal) => RecipientFacts | Promise<RecipientFacts>;
    updateClaims?: (change: (book: ClaimBookValue) => ClaimBookValue) => Promise<ClaimBookValue>;
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
    signal?: AbortSignal;
}
export interface RequestInput {
    sessionId: string;
    agentPreset?: string;
    events: HistoryEvent[];
    visible?: MessageView[];
    accepted?: MessageView[];
    signal?: AbortSignal;
}
export interface CollectInput {
    sessionId: string;
    agentPreset?: string;
    visible: MessageView[];
    accepted?: MessageView[];
    committedIds?: string[];
    candidateIds?: string[];
    signal?: AbortSignal;
}
/** JSON transport copying is intentional: optional undefined fields do not enter durable records. */
export declare function jsonCopy(value: unknown): unknown;
export declare function errorMessage(error: unknown): string;
export declare function errorDetail(error: unknown): {
    diagnostic?: undefined;
} | {
    diagnostic: z.core.util.JSONType;
};
export {};
