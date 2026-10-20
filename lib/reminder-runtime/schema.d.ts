import { z } from 'zod';
import type { CountLimitValues } from './conditions.js';
import { type EventFieldShape } from './generated/session-events.js';
export declare const ReminderScope: z.ZodPipe<z.ZodObject<{
    sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
    condition: z.ZodOptional<z.ZodJSONSchema>;
}, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
    sessionIds?: string[] | undefined;
    agentPresets?: string[] | undefined;
    condition?: z.core.util.JSONType | undefined;
}>>;
export declare const ReminderRule: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
export declare const ReminderConfig: z.ZodPrefault<z.ZodObject<{
    countLimits: z.ZodDefault<z.ZodObject<{
        maxTextChars: z.ZodNumber;
        maxCandidates: z.ZodNumber;
        maxUnits: z.ZodNumber;
        maxEvidence: z.ZodNumber;
    }, z.core.$strict>>;
    ruleTimeoutMs: z.ZodDefault<z.ZodNumber>;
    roundTimeoutMs: z.ZodDefault<z.ZodNumber>;
    storageTimeoutMs: z.ZodDefault<z.ZodNumber>;
    maxConcurrent: z.ZodDefault<z.ZodNumber>;
    maxQueued: z.ZodDefault<z.ZodNumber>;
    maxReminderChain: z.ZodDefault<z.ZodNumber>;
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
    maxIdle: z.ZodOptional<z.ZodNumber>;
    maxContextMessages: z.ZodDefault<z.ZodNumber>;
    maxContextChars: z.ZodDefault<z.ZodNumber>;
    maxToolExecutions: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>>;
export declare const Source: z.ZodObject<{
    sourceId: z.ZodString;
    plugin: z.ZodString;
    sessionId: z.ZodOptional<z.ZodString>;
    scope: z.ZodOptional<z.ZodPipe<z.ZodObject<{
        sessionIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        agentPresets: z.ZodOptional<z.ZodArray<z.ZodString>>;
        condition: z.ZodOptional<z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodTransform<import("./scope.js").RecipientScope, {
        sessionIds?: string[] | undefined;
        agentPresets?: string[] | undefined;
        condition?: z.core.util.JSONType | undefined;
    }>>>;
    revision: z.ZodNumber;
    rules: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "on">>;
    diagnostics: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        message: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/** Event names a rule may select beyond the built-in catalog: declared custom events. */
export interface DeclaredEvents {
    names: ReadonlySet<string>;
    shapes: ReadonlyMap<string, EventFieldShape>;
}
/** Compile one rule's readable form into the bounded condition tree the matcher evaluates. */
export declare function compileRule(input: unknown, limits?: CountLimitValues, declared?: DeclaredEvents): {
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
        condition?: z.core.util.JSONType | undefined;
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
        params?: z.core.util.JSONType | undefined;
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
        condition?: z.core.util.JSONType | undefined;
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
        params?: z.core.util.JSONType | undefined;
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
        condition?: z.core.util.JSONType | undefined;
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
        params?: z.core.util.JSONType | undefined;
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
        condition?: z.core.util.JSONType | undefined;
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
        params?: z.core.util.JSONType | undefined;
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
        condition?: z.core.util.JSONType | undefined;
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
        params?: z.core.util.JSONType | undefined;
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
        condition?: z.core.util.JSONType | undefined;
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
        params?: z.core.util.JSONType | undefined;
        timeoutMs?: number | undefined;
    } | undefined;
};
export type CompiledRule = ReturnType<typeof compileRule>;
