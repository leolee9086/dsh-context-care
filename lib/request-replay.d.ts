import { z } from 'zod';
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionLog } from './session-log.js';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { SessionRequestRecord } from './request-history.js';
/**
 * Read request-only inputs already committed by their producer.
 * @param event a committed Session event
 * @returns logged input changes, or undefined for unrelated events
 */
export declare function requestDecision(event: SessionEvent): {
    seq: import("@deepseek-ai/dsh-session").SessionSeq;
    prompt: {
        [x: string]: unknown;
        callId: string;
        segments: Record<string, z.core.util.JSONType>[];
        message?: import("@deepseek-ai/dsh-llm").RequestMessage | undefined;
    } | undefined;
    workbench: {
        [x: string]: unknown;
        callId: string;
        diff: {
            after: {
                messages: import("@deepseek-ai/dsh-llm").RequestMessage[];
                system?: string | undefined;
            };
        };
    } | undefined;
} | undefined;
/**
 * Reconstruct one settled conversation's input using the native Session surface
 * projection. Only calibration misses need this; no provider or judge is called.
 * @param logs - the Host-owned native log and historical projection service.
 * @param session - the original event log.
 * @param record - the settlement to price.
 * @returns the historical input, including committed request-only changes.
 */
export declare function replayRequest(logs: SessionLog, session: Session, record: SessionRequestRecord): {
    session: Session;
    request: GenerateOptions;
    promptDecision: ({
        [x: string]: unknown;
        callId: string;
        segments: Record<string, z.core.util.JSONType>[];
        message?: import("@deepseek-ai/dsh-llm").RequestMessage | undefined;
    } & {
        seq: number;
    }) | undefined;
    sourceSeqs: import("@deepseek-ai/dsh-session").SessionSeq[];
};
