import { z } from 'zod';
import { MatchResult } from './state.js';
import type { BatchRuleInput, EventValue, RuntimeOptions } from './state.js';
import type { CountLimitValues } from './conditions.js';
export interface RuleAnswer {
    match?: z.infer<typeof MatchResult>;
    error?: unknown;
    /** No execution checkpoint was entered before the round ran out of time. */
    notStarted?: boolean;
}
/** Validate one untrusted worker item independently of scheduling and I/O. */
export declare function parseRuleAnswer(raw: unknown): RuleAnswer;
interface EvaluationInput {
    event: EventValue;
    rules: BatchRuleInput[];
    maxBytes: number;
    countLimits: CountLimitValues;
    remainingMs: number;
    ruleTimeoutMs: number;
    signal: AbortSignal;
    execute: NonNullable<RuntimeOptions['execute']>;
}
/**
 * Resume only the suffix proven not to have started by the worker checkpoint.
 * Completed results survive termination; the interrupted judge is never replayed.
 * Every healthy round uses one batch, in the same order as sequential evaluation.
 */
export declare function evaluateRules(input: EvaluationInput): Promise<{
    answers: Map<string, RuleAnswer>;
    remainingMs: number;
}>;
export {};
