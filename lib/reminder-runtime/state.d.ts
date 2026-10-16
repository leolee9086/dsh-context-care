import { z } from 'zod';
import { ReminderRule, Source, compileRule } from './schema.js';
import { CapacitySettings, CapacityWire } from './capacity.js';
import type { ClaimBookValue } from './claims.js';
import type { HistoryEvent, MessageView } from './request-context.js';
import type { RecipientFacts } from './scope.js';
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
    facts: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
}, z.core.$catchall<z.ZodJSONSchema>>;
export declare const MatchResult: z.ZodObject<{
    ok: z.ZodBoolean;
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
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        reserved: "reserved";
        pending: "pending";
        delivered: "delivered";
        discarded: "discarded";
    }>;
    messageId: z.ZodOptional<z.ZodString>;
    evidence: z.ZodJSONSchema;
    rule: z.ZodDiscriminatedUnion<[z.ZodObject<{
        format: z.ZodLiteral<"reminder/v1">;
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
        deliver: z.ZodObject<{
            model: z.ZodObject<{
                once: z.ZodLiteral<"surface">;
                shared: z.ZodOptional<z.ZodObject<{
                    reset: z.ZodLiteral<"lifetime">;
                    lifetime: z.ZodString;
                    limit: z.ZodNumber;
                }, z.core.$strict>>;
            }, z.core.$strict>;
        }, z.core.$strict>;
        on: z.ZodEnum<{
            "tool.succeeded": "tool.succeeded";
            "tool.failed": "tool.failed";
        }>;
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
    }, z.core.$strict>, z.ZodObject<{
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
        format: z.ZodLiteral<"reminder/v2">;
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
        deliver: z.ZodObject<{
            model: z.ZodObject<{
                once: z.ZodEnum<{
                    window: "window";
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
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
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
        format: z.ZodLiteral<"reminder/v3">;
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
        deliver: z.ZodObject<{
            model: z.ZodObject<{
                once: z.ZodEnum<{
                    window: "window";
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
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>], "format">;
}, z.core.$strip>;
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
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            reserved: "reserved";
            pending: "pending";
            delivered: "delivered";
            discarded: "discarded";
        }>;
        messageId: z.ZodOptional<z.ZodString>;
        evidence: z.ZodJSONSchema;
        rule: z.ZodDiscriminatedUnion<[z.ZodObject<{
            format: z.ZodLiteral<"reminder/v1">;
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
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodLiteral<"surface">;
                    shared: z.ZodOptional<z.ZodObject<{
                        reset: z.ZodLiteral<"lifetime">;
                        lifetime: z.ZodString;
                        limit: z.ZodNumber;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
            }, z.core.$strict>;
            on: z.ZodEnum<{
                "tool.succeeded": "tool.succeeded";
                "tool.failed": "tool.failed";
            }>;
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
        }, z.core.$strict>, z.ZodObject<{
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
            format: z.ZodLiteral<"reminder/v2">;
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
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
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
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
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
            format: z.ZodLiteral<"reminder/v3">;
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
            deliver: z.ZodObject<{
                model: z.ZodObject<{
                    once: z.ZodEnum<{
                        window: "window";
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
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>], "format">;
    }, z.core.$strip>>;
    diagnostics: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    windows: z.ZodDefault<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        until: z.ZodNumber;
        messageId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
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
            }, z.core.$strict>;
        };
    };
};
export type CandidateValue = z.infer<typeof Candidate>;
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
        judge?: DetectorValue;
        params?: z.infer<ReturnType<typeof z.json>>;
    };
};
export interface RuntimeOptions {
    config?: unknown;
    entries?: Iterable<readonly [string, unknown]>;
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
