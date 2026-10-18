import { z } from 'zod';
/** Measurement configuration after the caller resolves the rule's text field. */
export declare const TextCountConfig: z.ZodObject<{
    projection: z.ZodEnum<{
        raw: "raw";
        "markdown-prose": "markdown-prose";
    }>;
    locale: z.ZodString;
    metaPrefixes: z.ZodDefault<z.ZodArray<z.ZodString>>;
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
    limits: z.ZodObject<{
        maxTextChars: z.ZodNumber;
        maxCandidates: z.ZodNumber;
        maxUnits: z.ZodNumber;
        maxEvidence: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export type TextCountOptions = z.infer<typeof TextCountConfig>;
export type MatchTruth = 'matched' | 'unmatched' | 'unavailable';
interface Hit {
    start: number;
    end: number;
    patternId: string;
}
export interface TextCounts {
    occurrences: number;
    'matched-sentences': number;
    'matched-words': number;
    sentences: number;
    words: number;
}
export type TextCountResult = {
    status: 'matched' | 'unmatched';
    value: number;
    counts: TextCounts;
    evidence: Hit[];
    evidenceTruncated: boolean;
} | {
    status: 'unavailable';
    reason: string;
};
/** Unknown evidence remains unknown under negation. */
export declare function negateTruth(value: MatchTruth): MatchTruth;
/** A decisive child wins; otherwise a missing measurement propagates upward. */
export declare function combineTruth(kind: 'all' | 'any', values: readonly MatchTruth[]): MatchTruth;
/**
 * Measure one complete string or cumulative prefix. Run regex measurements in
 * the bounded matcher worker: regex execution itself cannot observe a timer.
 * Evidence is cropped independently of the counts, with original UTF-16 ranges.
 */
export declare function measureTextCount(text: string, config: TextCountOptions): TextCountResult;
export {};
