export interface WorkerError {
    name: string;
    message: string;
}
/**
 * Exceptions cross a MessagePort too. A judge can throw an Error whose runtime
 * fields violate Error's TS declaration, so only checked strings enter replies.
 * Keep each caller's existing non-Error message convention via messageOf.
 */
export declare function serializeWorkerError(error: unknown, messageOf: (error: unknown) => unknown): WorkerError;
