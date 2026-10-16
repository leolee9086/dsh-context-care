import { z } from 'zod';
export declare const ReminderScope: z.ZodPipe<z.ZodObject<{
    sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
    sessionIds?: string[] | undefined;
    agentPresets?: string[] | undefined;
}>>;
export declare const ReminderRule: z.ZodDiscriminatedUnion<[z.ZodObject<{
    format: z.ZodLiteral<"reminder/v1">;
    id: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    priority: z.ZodDefault<z.ZodNumber>;
    exclusiveGroup: z.ZodOptional<z.ZodString>;
    scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
        sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
        sessionIds?: string[] | undefined;
        agentPresets?: string[] | undefined;
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
    }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
        sessionIds?: string[] | undefined;
        agentPresets?: string[] | undefined;
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
    }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
        sessionIds?: string[] | undefined;
        agentPresets?: string[] | undefined;
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
export declare const ReminderConfig: z.ZodPrefault<z.ZodObject<{
    ruleTimeoutMs: z.ZodDefault<z.ZodNumber>;
    roundTimeoutMs: z.ZodDefault<z.ZodNumber>;
    maxConcurrent: z.ZodDefault<z.ZodNumber>;
    maxQueued: z.ZodDefault<z.ZodNumber>;
    maxRules: z.ZodDefault<z.ZodNumber>;
    maxBytes: z.ZodDefault<z.ZodNumber>;
    maxClaimBytes: z.ZodDefault<z.ZodNumber>;
    maxStreamChars: z.ZodDefault<z.ZodNumber>;
    maxStreamBlocks: z.ZodDefault<z.ZodNumber>;
    maxStreamPending: z.ZodDefault<z.ZodNumber>;
    maxStreamPendingBytes: z.ZodDefault<z.ZodNumber>;
    streamEveryChars: z.ZodDefault<z.ZodNumber>;
    streamFlushMs: z.ZodDefault<z.ZodNumber>;
    maxInterruptsPerTurn: z.ZodDefault<z.ZodNumber>;
    maxCandidates: z.ZodDefault<z.ZodNumber>;
    maxIdle: z.ZodDefault<z.ZodNumber>;
    maxContextMessages: z.ZodDefault<z.ZodNumber>;
    maxContextChars: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>>;
export declare const Source: z.ZodObject<{
    sourceId: z.ZodString;
    plugin: z.ZodString;
    sessionId: z.ZodOptional<z.ZodString>;
    scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
        sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
        sessionIds?: string[] | undefined;
        agentPresets?: string[] | undefined;
    }>>>;
    revision: z.ZodNumber;
    rules: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        format: z.ZodLiteral<"reminder/v1">;
        id: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        priority: z.ZodDefault<z.ZodNumber>;
        exclusiveGroup: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
            sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
            agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
            sessionIds?: string[] | undefined;
            agentPresets?: string[] | undefined;
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
        }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
            sessionIds?: string[] | undefined;
            agentPresets?: string[] | undefined;
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
        }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
            sessionIds?: string[] | undefined;
            agentPresets?: string[] | undefined;
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
    }, z.core.$strict>], "format">>;
    diagnostics: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        message: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/** Compile the readable reminder form to the existing engine's conditions. */
export declare function compileRule(input: unknown, sourceId: string, revision: number): {
    condition: z.core.util.JSONType;
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
        condition?: z.core.util.JSONType | undefined;
    };
    title?: string | undefined;
    exclusiveGroup?: string | undefined;
    scope?: import("./scope.js").RecipientScope | undefined;
    judge?: {
        ref: string;
        revision: number;
        params?: z.core.util.JSONType | undefined;
        timeoutMs?: number | undefined;
    } | undefined;
} | {
    condition: z.core.util.JSONType;
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
        condition?: z.core.util.JSONType | undefined;
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
        params?: z.core.util.JSONType | undefined;
        timeoutMs?: number | undefined;
    } | undefined;
} | {
    condition: z.core.util.JSONType;
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
        condition?: z.core.util.JSONType | undefined;
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
        params?: z.core.util.JSONType | undefined;
        timeoutMs?: number | undefined;
    } | undefined;
};
