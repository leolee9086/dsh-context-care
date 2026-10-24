/** Resources used by actual writes must outlive an observation timeout. */
export interface ReminderShutdown {
    close(): Promise<void>;
    drainPersistence(): Promise<void>;
}
/**
 * Runtime close is bounded and reports unknown I/O. Host disposal must additionally
 * keep its storage domains alive until the real writes and compensation stop.
 * Uncancellable I/O can therefore delay Host disposal; we do not claim hard cancellation.
 */
export declare function shutdownReminderRuntime(runtime: ReminderShutdown): Promise<void>;
