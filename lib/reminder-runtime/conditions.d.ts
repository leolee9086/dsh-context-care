import { z } from 'zod';
import { type MatchTruth, type TextCountResult } from './text-count.js';
declare const Json: z.ZodJSONSchema;
type JsonValue = z.infer<typeof Json>;
/** Host measurement ceilings; rules may choose smaller limits, never larger ones. */
export declare const CountLimits: z.ZodDefault<z.ZodObject<{
    maxTextChars: z.ZodNumber;
    maxCandidates: z.ZodNumber;
    maxUnits: z.ZodNumber;
    maxEvidence: z.ZodNumber;
}, z.core.$strict>>;
export type CountLimitValues = z.infer<typeof CountLimits>;
declare const Count: z.ZodObject<{
    kind: z.ZodLiteral<"count">;
    source: z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        field: z.ZodString;
        projection: z.ZodEnum<{
            raw: "raw";
            "markdown-prose": "markdown-prose";
        }>;
        locale: z.ZodString;
        metaPrefixes: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    pattern: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"literal">;
        text: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"keywords">;
        values: z.ZodArray<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"regex">;
        pattern: z.ZodString;
        flags: z.ZodDefault<z.ZodString>;
    }, z.core.$strict>], "kind">;
    metric: z.ZodUnion<readonly [z.ZodEnum<{
        occurrences: "occurrences";
        "matched-sentences": "matched-sentences";
        "matched-words": "matched-words";
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"ratio">;
        numerator: z.ZodEnum<{
            occurrences: "occurrences";
            "matched-sentences": "matched-sentences";
            "matched-words": "matched-words";
        }>;
        denominator: z.ZodEnum<{
            sentences: "sentences";
            words: "words";
        }>;
        minDenominator: z.ZodNumber;
        scale: z.ZodDefault<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<100>]>>;
    }, z.core.$strict>]>;
    window: z.ZodObject<{
        kind: z.ZodEnum<{
            "current-block": "current-block";
            "current-output": "current-output";
        }>;
    }, z.core.$strict>;
    evaluate: z.ZodDefault<z.ZodEnum<{
        complete: "complete";
        prefix: "prefix";
    }>>;
    compare: z.ZodObject<{
        op: z.ZodEnum<{
            eq: "eq";
            ne: "ne";
            gt: "gt";
            gte: "gte";
            lt: "lt";
            lte: "lte";
        }>;
        value: z.ZodNumber;
    }, z.core.$strict>;
    limits: z.ZodDefault<z.ZodObject<{
        maxTextChars: z.ZodNumber;
        maxCandidates: z.ZodNumber;
        maxUnits: z.ZodNumber;
        maxEvidence: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
type CountCondition = z.infer<typeof Count>;
declare const Leaf: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"always">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"compare">;
    field: z.ZodString;
    op: z.ZodEnum<{
        eq: "eq";
        ne: "ne";
        gt: "gt";
        gte: "gte";
        lt: "lt";
        lte: "lte";
        contains: "contains";
        exists: "exists";
    }>;
    value: z.ZodOptional<z.ZodJSONSchema>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"regex">;
    field: z.ZodString;
    pattern: z.ZodString;
    flags: z.ZodOptional<z.ZodString>;
    all: z.ZodOptional<z.ZodLiteral<false>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"keywords">;
    field: z.ZodString;
    values: z.ZodArray<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<{
        ANY: "ANY";
        ALL: "ALL";
        "NOT-ANY": "NOT-ANY";
        "NOT-ALL": "NOT-ALL";
    }>>;
    caseSensitive: z.ZodOptional<z.ZodBoolean>;
    wordBoundary: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>], "kind">;
export type ReminderCondition = z.infer<typeof Leaf> | CountCondition | {
    kind: 'all' | 'any';
    conditions: ReminderCondition[];
} | {
    kind: 'not';
    condition: ReminderCondition;
};
/** Parse document or worker JSON into a bounded condition tree before execution. */
export declare function compileReminderCondition(input: unknown, ceilings?: {
    maxTextChars: number;
    maxCandidates: number;
    maxUnits: number;
    maxEvidence: number;
}): ReminderCondition;
declare const TextSample: z.ZodObject<{
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
}, z.core.$strict>;
export declare const TextSamples: z.ZodArray<z.ZodObject<{
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
}, z.core.$strict>>;
export type TextSampleValue = z.infer<typeof TextSample>;
interface Measurement {
    path: string;
    field: string;
    sampleId?: string;
    result: TextCountResult;
}
export interface ReminderMatch {
    ok: boolean;
    status: MatchTruth;
    ranges: [number, number][];
    captures: Record<string, JsonValue>;
    measurements: Measurement[];
    diagnostics: {
        path: string;
        message: string;
    }[];
    field?: string;
}
/** Run inside the cancellable matcher worker; missing evidence never becomes true under not. */
export declare function matchReminderCondition(condition: ReminderCondition, snapshot: JsonValue, samples?: readonly TextSampleValue[]): ReminderMatch;
export {};
