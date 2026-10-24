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
/** Registration checks both the bounded data shape and rule-engine semantics. */
export declare function compileReminderCondition(input: unknown, ceilings?: CountLimitValues): ReminderCondition;
/**
 * Structured clone does not retain a TypeScript proof. Recheck the bounded data
 * shape in the worker without recompiling the rule-engine declaration each time.
 */
export declare function parseReminderCondition(input: unknown, ceilings: CountLimitValues): ReminderCondition;
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
/**
 * 执行期把规则自带的测量上限再夹一次宿主 ceilings。
 *
 * 注册时 `compileRule` 已经夹过一次，这里是纵深防御：worker 里跑的代码
 * 不该信任调用方递过来的树。只走树、不做解析，而且没有任何节点需要改时
 * 直接返回原对象——所以它不会像重新编译那样每轮分配一整棵新树。
 */
export declare function clampCountLimits(condition: ReminderCondition, ceilings: CountLimitValues): ReminderCondition;
export declare function matchReminderCondition(condition: ReminderCondition, snapshot: JsonValue, samples?: readonly TextSampleValue[]): ReminderMatch;
export {};
