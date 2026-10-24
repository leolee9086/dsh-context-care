import type { CandidateValue } from './state.js';
import type { MessageView } from './request-context.js';
/**
 * Identify the rule and control generation that supplied an actual inbox message.
 * This is delivery evidence, not a serialized runtime state or a source token.
 * @param candidate - the matched, rendered candidate being handed to the inbox.
 * @returns stable delivery validity fields, absent for older unsigned candidates.
 */
export declare function reminderHandoff(candidate: CandidateValue): {
    revision: number;
    policy: string | number;
    format: "context-care/reminder-handoff/v1";
    sourceSignature: string;
    sticky?: {
        activationId: string;
        charged: boolean;
    } | undefined;
    request?: {
        type: "request.before";
        humanActivity?: {
            at: number;
            evidence: string;
        } | null | undefined;
    } | undefined;
    queued?: true | undefined;
} | undefined;
/**
 * Recover only a real handed message; replay never invokes a judge or template.
 * Legacy messages without the validity fields cannot establish a new reservation.
 * @param sessionId - the recipient whose native inbox supplied the message.
 * @param message - a message claimed from that inbox at the next pre-step.
 * @returns a reserved candidate with its original message identity and frozen body.
 */
export declare function candidateFromMessage(sessionId: string, message: MessageView): CandidateValue | undefined;
