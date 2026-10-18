/** Source ranges use UTF-16 offsets, matching JS strings and mdast positions. */
export interface TextSpan {
    text: string;
    start: number;
    end: number;
}
/** Soft line breaks and locale sentence boundaries split the same source span. */
export declare function textStatements(text: string, locale: string, start?: number): TextSpan[];
export declare function markdownStatements(text: string, locale?: string): TextSpan[];
/** Numerator and denominator consume this one projection; offsets stay original. */
export declare function projectText(text: string, projection: 'raw' | 'markdown-prose', locale: string, metaPrefixes: readonly string[]): {
    text: string;
    statements: TextSpan[];
    included: Uint8Array<ArrayBuffer>;
};
