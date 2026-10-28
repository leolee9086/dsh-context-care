import { z } from 'zod';
/** Only requested views are materialized; paging/filter changes replace their subscription. */
export declare const CareSubscription: z.ZodObject<{
    sessionId: z.ZodString;
    topic: z.ZodEnum<{
        status: "status";
        actions: "actions";
        prompts: "prompts";
        rewrites: "rewrites";
        controls: "controls";
        runtime: "runtime";
    }>;
    offset: z.ZodDefault<z.ZodNumber>;
    seq: z.ZodOptional<z.ZodNumber>;
    status: z.ZodDefault<z.ZodEnum<{
        "": "";
        queued: "queued";
        cancelled: "cancelled";
        unknown: "unknown";
        failed: "failed";
        "waiting-approval": "waiting-approval";
        running: "running";
        succeeded: "succeeded";
        skipped: "skipped";
    }>>;
    search: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export type CareSubscriptionValue = z.infer<typeof CareSubscription>;
export type CareSubscriptionInput = z.input<typeof CareSubscription>;
export declare const careSubscriptionKey: (value: CareSubscriptionValue) => string;
export declare const CareFrame: z.ZodDiscriminatedUnion<[z.ZodObject<{
    key: z.ZodString;
    sessionId: z.ZodString;
    topic: z.ZodEnum<{
        status: "status";
        actions: "actions";
        prompts: "prompts";
        rewrites: "rewrites";
        controls: "controls";
        runtime: "runtime";
    }>;
    revision: z.ZodNumber;
    type: z.ZodLiteral<"snapshot">;
    value: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
}, z.core.$strip>, z.ZodObject<{
    key: z.ZodString;
    sessionId: z.ZodString;
    topic: z.ZodEnum<{
        status: "status";
        actions: "actions";
        prompts: "prompts";
        rewrites: "rewrites";
        controls: "controls";
        runtime: "runtime";
    }>;
    revision: z.ZodNumber;
    type: z.ZodLiteral<"delta">;
    value: z.ZodObject<{
        records: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
        removed: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    key: z.ZodString;
    sessionId: z.ZodString;
    topic: z.ZodEnum<{
        status: "status";
        actions: "actions";
        prompts: "prompts";
        rewrites: "rewrites";
        controls: "controls";
        runtime: "runtime";
    }>;
    revision: z.ZodNumber;
    type: z.ZodLiteral<"error">;
    error: z.ZodObject<{
        name: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>], "type">;
export type CareFrameValue = z.infer<typeof CareFrame>;
export type CareUpdate = CareFrameValue | {
    type: 'error';
    error: {
        name: string;
        message: string;
    };
};
export declare const CARE_FRAME_BYTES: number;
