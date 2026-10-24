import { z } from 'zod';
import type { ToolOutputDefinition } from '@deepseek-ai/dsh-tools';
export declare const SNOOZE_TOOL = "reminder_snooze";
export declare const SnoozeWindow: z.ZodObject<{
    sourceId: z.ZodString;
    ruleId: z.ZodString;
    key: z.ZodString;
    until: z.ZodNumber;
}, z.core.$strict>;
export type SnoozeWindowValue = z.infer<typeof SnoozeWindow>;
export declare const SnoozeResult: z.ZodObject<{
    format: z.ZodLiteral<"context-care/snooze/v1">;
    sessionId: z.ZodString;
    summary: z.ZodString;
    windows: z.ZodArray<z.ZodObject<{
        sourceId: z.ZodString;
        ruleId: z.ZodString;
        key: z.ZodString;
        until: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SnoozeResultValue = z.infer<typeof SnoozeResult>;
/** Facts selected by one real tool invocation, not a snapshot of reminder state. */
export declare function snoozeResult(sessionId: string, windows: SnoozeWindowValue[]): SnoozeResultValue;
/** Nested dispatches also retain content, even when presentationMeta is omitted. */
export declare const snoozeOutput: ToolOutputDefinition;
/** Read the committed result, never reselect rules using today's definitions. */
export declare function readSnoozeResult(content: readonly unknown[], meta: unknown): SnoozeResultValue | undefined;
