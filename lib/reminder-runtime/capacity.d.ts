import { z } from 'zod';
export declare const RuleLimit: z.ZodNumber;
export declare const CapacitySettings: z.ZodObject<{
    revision: z.ZodNumber;
    maxRules: z.ZodNumber;
}, z.core.$strict>;
export declare const CapacityWire: z.ZodObject<{
    revision: z.ZodNumber;
    maxRules: z.ZodNumber;
    registeredRules: z.ZodNumber;
    rejections: z.ZodArray<z.ZodObject<{
        sourceId: z.ZodString;
        sourceRules: z.ZodNumber;
        totalRules: z.ZodNumber;
        limit: z.ZodNumber;
        message: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare class CapacityError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
