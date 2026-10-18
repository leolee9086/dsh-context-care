import { z } from 'zod';
import { projectText } from './text-projection.js';
const AbsoluteMetric = z.enum(['occurrences', 'matched-sentences', 'matched-words']);
const Pattern = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), text: z.string().min(1).max(4096) }).strict(),
    z.object({ kind: z.literal('keywords'), values: z.array(z.string().min(1).max(4096)).min(1).max(128) }).strict(),
    z.object({ kind: z.literal('regex'), pattern: z.string().min(1).max(4096), flags: z.string().regex(/^[imsu]*$/).default('u') }).strict(),
]);
/** Measurement configuration after the caller resolves the rule's text field. */
export const TextCountConfig = z.object({
    projection: z.enum(['raw', 'markdown-prose']), locale: z.string().min(1),
    metaPrefixes: z.array(z.string().min(1)).max(128).default([]),
    pattern: Pattern,
    metric: z.union([AbsoluteMetric, z.object({
            kind: z.literal('ratio'), numerator: AbsoluteMetric,
            denominator: z.enum(['sentences', 'words']), minDenominator: z.number().int().positive(),
            scale: z.union([z.literal(1), z.literal(100)]).default(1),
        }).strict()]),
    compare: z.object({ op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']), value: z.number().finite() }).strict(),
    limits: z.object({
        maxTextChars: z.number().int().positive().max(1048576),
        maxCandidates: z.number().int().positive().max(100000),
        maxUnits: z.number().int().positive().max(100000),
        maxEvidence: z.number().int().nonnegative().max(10000),
    }).strict(),
}).strict().superRefine((config, context) => {
    try {
        new Intl.Segmenter(config.locale);
    }
    catch {
        context.addIssue({ code: 'custom', path: ['locale'], message: 'invalid segmentation locale' });
    }
    if (config.pattern.kind === 'regex') {
        try {
            new RegExp(config.pattern.pattern, config.pattern.flags);
        }
        catch {
            context.addIssue({ code: 'custom', path: ['pattern'], message: 'invalid regular expression' });
        }
    }
});
/** Unknown evidence remains unknown under negation. */
export function negateTruth(value) {
    return value === 'unavailable' ? value : value === 'matched' ? 'unmatched' : 'matched';
}
/** A decisive child wins; otherwise a missing measurement propagates upward. */
export function combineTruth(kind, values) {
    const decisive = kind === 'all' ? 'unmatched' : 'matched';
    if (values.includes(decisive))
        return decisive;
    if (values.includes('unavailable'))
        return 'unavailable';
    return kind === 'all' ? 'matched' : 'unmatched';
}
function compare(value, comparison) {
    switch (comparison.op) {
        case 'eq': return value === comparison.value;
        case 'ne': return value !== comparison.value;
        case 'gt': return value > comparison.value;
        case 'gte': return value >= comparison.value;
        case 'lt': return value < comparison.value;
        case 'lte': return value <= comparison.value;
    }
}
/**
 * Measure one complete string or cumulative prefix. Run regex measurements in
 * the bounded matcher worker: regex execution itself cannot observe a timer.
 * Evidence is cropped independently of the counts, with original UTF-16 ranges.
 */
export function measureTextCount(text, config) {
    const { limits } = config;
    if (text.length > limits.maxTextChars)
        return { status: 'unavailable', reason: 'maxTextChars' };
    const projected = projectText(text, config.projection, config.locale, config.metaPrefixes);
    if (projected.statements.length > limits.maxUnits)
        return { status: 'unavailable', reason: 'maxUnits' };
    const candidates = [];
    const add = (start, end, patternId) => {
        // Blanks preserve offsets but are not evidence: a match cannot cross an excluded region.
        if (projected.included.subarray(start, end).some(value => value === 0))
            return true;
        if (candidates.length === limits.maxCandidates)
            return false;
        candidates.push({ start, end, patternId });
        return true;
    };
    const pattern = config.pattern;
    if (pattern.kind === 'regex') {
        const regex = new RegExp(pattern.pattern, `${pattern.flags}g`);
        for (let match = regex.exec(projected.text); match !== null; match = regex.exec(projected.text)) {
            if (match[0].length === 0)
                return { status: 'unavailable', reason: 'zero-width-match' };
            if (!add(match.index, match.index + match[0].length, 'regex'))
                return { status: 'unavailable', reason: 'maxCandidates' };
        }
    }
    else {
        const literals = pattern.kind === 'literal' ? [pattern.text] : pattern.values;
        for (const [index, literal] of literals.entries()) {
            let at = projected.text.indexOf(literal);
            while (at !== -1) {
                if (!add(at, at + literal.length, String(index)))
                    return { status: 'unavailable', reason: 'maxCandidates' };
                // Include overlaps here; the common longest-first pass decides which survive.
                at = projected.text.indexOf(literal, at + 1);
            }
        }
    }
    candidates.sort((left, right) => (right.end - right.start) - (left.end - left.start)
        || left.start - right.start || (left.patternId < right.patternId ? -1 : left.patternId > right.patternId ? 1 : 0));
    const occupied = new Uint8Array(text.length);
    const hits = [];
    const overlaps = (start, end) => occupied.subarray(start, end).some(value => value !== 0);
    for (const hit of candidates) {
        if (overlaps(hit.start, hit.end))
            continue;
        occupied.fill(1, hit.start, hit.end);
        hits.push(hit);
    }
    let words = 0, matchedWords = 0;
    const segmenter = new Intl.Segmenter(config.locale, { granularity: 'word' });
    for (const part of segmenter.segment(projected.text)) {
        if (!part.isWordLike)
            continue;
        if (++words > limits.maxUnits)
            return { status: 'unavailable', reason: 'maxUnits' };
        if (overlaps(part.index, part.index + part.segment.length))
            matchedWords++;
    }
    const counts = {
        occurrences: hits.length,
        'matched-sentences': projected.statements.filter(span => overlaps(span.start, span.end)).length,
        'matched-words': matchedWords,
        sentences: projected.statements.length,
        words,
    };
    let value;
    if (typeof config.metric === 'string') {
        value = counts[config.metric];
    }
    else {
        const denominator = counts[config.metric.denominator];
        if (denominator < config.metric.minDenominator)
            return { status: 'unavailable', reason: 'minDenominator' };
        value = config.metric.scale * counts[config.metric.numerator] / denominator;
    }
    // The ordering of retained evidence is independent of longest-first selection.
    hits.sort((left, right) => left.start - right.start);
    return { status: compare(value, config.compare) ? 'matched' : 'unmatched', value, counts,
        evidence: hits.slice(0, limits.maxEvidence), evidenceTruncated: hits.length > limits.maxEvidence };
}
//# sourceMappingURL=text-count.js.map