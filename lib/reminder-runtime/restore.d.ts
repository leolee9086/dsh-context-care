import { z } from 'zod';
import type { StateValue } from './state.js';
/**
 * Retire pre-v4 candidates before validating the executable state. Keep event
 * deduplication, window receipts and diagnostics; shared claims live in their
 * own domain and are never released by this upgrade, including uncertain sends.
 */
export declare function restoreReminderState(input: unknown, at: number): {
    state: {
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
            evidence: z.core.util.JSONType;
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
                full: string;
            } | undefined;
            messageId?: string | undefined;
            rendered?: boolean | undefined;
            sticky?: {
                activationId: string;
                charged: boolean;
            } | undefined;
        }[];
        diagnostics: Record<string, z.core.util.JSONType>[];
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
    changed: boolean;
};
/**
 * Validate every record, then durably save retirements before publishing the
 * reminder service. A failed save rejects startup; reopening cannot replay old
 * pending work or silently reset consumed delivery quotas.
 */
export declare function restoreReminderEntries(entries: Iterable<readonly [string, unknown]>, save: (id: string, state: StateValue) => Promise<unknown> | void, at?: number): Promise<(readonly [string, {
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
        evidence: z.core.util.JSONType;
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
            full: string;
        } | undefined;
        messageId?: string | undefined;
        rendered?: boolean | undefined;
        sticky?: {
            activationId: string;
            charged: boolean;
        } | undefined;
    }[];
    diagnostics: Record<string, z.core.util.JSONType>[];
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
}])[]>;
