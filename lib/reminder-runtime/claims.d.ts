import { z } from 'zod';
export declare const ClaimBook: z.ZodObject<{
    buckets: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        until: z.ZodOptional<z.ZodNumber>;
        claims: z.ZodArray<z.ZodObject<{
            candidateId: z.ZodString;
            sessionId: z.ZodString;
            messageId: z.ZodString;
            status: z.ZodEnum<{
                reserved: "reserved";
                consumed: "consumed";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ClaimBookValue = z.infer<typeof ClaimBook>;
export type SharedQuota = {
    reset: 'lifetime';
    lifetime: string;
    limit: number;
} | {
    reset: 'window';
    limit: number;
};
export interface QuotaCandidate {
    sourceId: string;
    ruleId: string;
    rule: {
        effect: {
            deliver: {
                model: {
                    shared?: SharedQuota;
                };
            };
        };
    };
    window?: {
        id: string;
        end: number;
    };
}
export interface Reservation {
    key: string;
    limit: number;
    until?: number;
    candidateId: string;
    sessionId: string;
    messageId: string;
}
export interface ClaimOperation {
    reserve?: Reservation[];
    consume?: string[];
    release?: string[];
    at: number;
    maxBytes: number;
}
export declare const CLAIM_DOMAIN: {
    name: string;
    version: number;
    layout: "per-record";
    tables: {
        claims: {
            valueSchema: z.ZodObject<{
                buckets: z.ZodArray<z.ZodObject<{
                    key: z.ZodString;
                    until: z.ZodOptional<z.ZodNumber>;
                    claims: z.ZodArray<z.ZodObject<{
                        candidateId: z.ZodString;
                        sessionId: z.ZodString;
                        messageId: z.ZodString;
                        status: z.ZodEnum<{
                            reserved: "reserved";
                            consumed: "consumed";
                        }>;
                    }, z.core.$strict>>;
                }, z.core.$strict>>;
            }, z.core.$strict>;
        };
    };
};
/** A lifecycle name survives rule edits; a calendar window supplies its own identity. */
export declare function quotaFor(candidate: QuotaCandidate): {
    key: string;
    limit: number;
    until: number;
} | {
    key: string;
    limit: number;
    until?: undefined;
} | undefined;
/** Pure ledger transition, called inside the storage domain's atomic update. */
export declare function changeClaims(book: ClaimBookValue, { reserve, consume, release, at, maxBytes }: ClaimOperation): ClaimBookValue;
/** Read acknowledgement from the committed transition result, never from a later snapshot. */
export declare function hasClaim(book: ClaimBookValue, key: string, messageId: string): boolean;
