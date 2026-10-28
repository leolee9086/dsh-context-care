import type { ToolOutputDefinition } from '@deepseek-ai/dsh-tools';
import type { SnoozeWindowValue, SnoozeResultValue } from '@leolee9086/dsh-rule-engine';
export declare const SNOOZE_TOOL = "reminder_snooze";
/** Tool presentation is native; the retained domain fact comes from the engine. */
export declare function snoozeResult(sessionId: string, windows: SnoozeWindowValue[]): SnoozeResultValue;
export declare const snoozeOutput: ToolOutputDefinition;
