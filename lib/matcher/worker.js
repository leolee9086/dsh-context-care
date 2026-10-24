import { parentPort } from 'node:worker_threads';
import { z } from 'zod';
import { Detector, Event } from '../reminder-runtime/state.js';
import { executeReminderMatch, executeReminderBatch } from '../reminder-runtime/matcher.js';
import { progressWriter } from './progress.js';
import { serializeWorkerError } from './worker-error.js';
const Envelope = z.object({ taskId: z.string(), input: z.record(z.string(), z.unknown()),
    progress: z.instanceof(SharedArrayBuffer), workTimeoutMs: z.number().finite().nonnegative() }).strict();
const Analysis = z.object({ analyzer: Detector, event: Event, maxBytes: z.number().int().positive() }).strict();
const Facts = z.record(z.string(), z.json());
const moduleRecord = (value) => value !== null && typeof value === 'object';
async function analyze(raw) {
    const { analyzer, event, maxBytes } = Analysis.parse(raw);
    const loaded = await import(analyzer.module);
    if (!moduleRecord(loaded) || typeof loaded[analyzer.exportName] !== 'function')
        throw new Error('reminder-analyzer-export-missing');
    const evaluate = loaded[analyzer.exportName];
    if (typeof evaluate !== 'function')
        throw new Error('reminder-analyzer-export-missing');
    const facts = Facts.parse(await evaluate({ event, context: event.context ?? { messages: [], truncated: false } }));
    if (Buffer.byteLength(JSON.stringify(facts)) > maxBytes)
        throw new Error('reminder-analysis-budget-exceeded');
    return facts;
}
/** One typed lifecycle for reminders, analyzers and the existing detector engine. */
export function runWorker(legacy) {
    const port = parentPort;
    if (!port)
        throw new Error('matcher-worker-requires-parent');
    const handle = async (raw) => {
        const parsed = Envelope.safeParse(raw);
        if (!parsed.success) {
            if (moduleRecord(raw) && typeof raw.taskId === 'string')
                port.postMessage({ taskId: raw.taskId,
                    error: { name: 'TypeError', message: 'matcher-envelope-invalid' } });
            return;
        }
        const { taskId, input, progress, workTimeoutMs } = parsed.data;
        const checkpoint = progressWriter(progress);
        const send = (value) => port.postMessage({ taskId, ...value });
        try {
            send({ started: true });
            let result;
            if (input.reminderBatch !== undefined) {
                result = await executeReminderBatch(input.reminderBatch, item => send({ item }), checkpoint, workTimeoutMs);
            }
            else {
                checkpoint.start(0, workTimeoutMs);
                let elapsedMs;
                try {
                    result = input.analysis !== undefined ? await analyze(input.analysis)
                        : input.reminder !== undefined ? await executeReminderMatch(input.reminder)
                            : input.warmup ? null : await legacy(input);
                }
                finally {
                    elapsedMs = checkpoint.finish(0);
                }
                // The Host may have been busy until after completion. Enforce the same
                // execution budget here, without treating response transport as work.
                if (elapsedMs > workTimeoutMs)
                    throw new Error('matcher-work-timeout');
            }
            send({ result });
        }
        catch (error) {
            send({ error: serializeWorkerError(error, value => value instanceof Error ? value.message : String(value)) });
        }
        finally {
            // Completion follows the reply attempt. Computation ending alone is not
            // evidence that an error/result has actually entered the MessagePort.
            checkpoint.done();
        }
    };
    let queue = Promise.resolve();
    port.on('message', (raw) => {
        // If even the checked failure cannot be reported, make the actual Worker
        // fail instead of swallowing the error and stranding its Host task forever.
        // The Host then waits for its exit before releasing capacity.
        queue = queue.then(() => handle(raw), () => handle(raw)).catch((error) => {
            setImmediate(() => { throw error; });
        });
    });
    port.postMessage({ ready: true });
}
//# sourceMappingURL=worker.js.map