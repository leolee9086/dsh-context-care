/**
 * Runtime close is bounded and reports unknown I/O. Host disposal must additionally
 * keep its storage domains alive until the real writes and compensation stop.
 * Uncancellable I/O can therefore delay Host disposal; we do not claim hard cancellation.
 */
export async function shutdownReminderRuntime(runtime) {
    let failure;
    try {
        await runtime.close();
    }
    catch (error) {
        failure = error;
    }
    try {
        await runtime.drainPersistence();
    }
    catch (error) {
        throw failure === undefined ? error : new AggregateError([failure, error], 'reminder-shutdown-failed');
    }
    if (failure !== undefined) {
        // Finish local cleanup after a recovered drain, but retain the original timeout report.
        await runtime.close();
        throw failure;
    }
}
//# sourceMappingURL=shutdown.js.map