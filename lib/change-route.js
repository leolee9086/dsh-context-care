import { z } from 'zod';
import { rewriteCut } from './rewrite-feed.js';
import { CARE_FRAME_BYTES, CareSubscription, careSubscriptionKey } from './care-stream.js';
const Value = z.record(z.string(), z.json());
/** One authenticated connection pushes the subscribed data, including its initial snapshot.
 * Each view has one pending read; backpressure coalesces changes instead of queuing bodies.
 * A failed view reports its original exception and waits for an explicit resubscription. */
export function installChangeRoute(ctx, changes, read) {
    const streams = new Set();
    const stop = ctx.webServer.register({ kind: 'exact', path: '/context-care/changes', handler(req, res) {
            const connection = ctx.get('connection');
            const rejected = connection === undefined ? 503 : connection.requestRejection(req);
            if (rejected !== undefined) {
                res.writeHead(rejected);
                res.end();
                return;
            }
            if (req.method !== 'GET') {
                res.writeHead(405, { allow: 'GET' });
                res.end();
                return;
            }
            const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
            let queries;
            try {
                queries = z.array(CareSubscription).min(1).parse(params.getAll('subscription').map(value => JSON.parse(value)));
            }
            catch (error) {
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'invalid-subscription', message: error instanceof Error ? error.message : String(error) }));
                return;
            }
            if (queries.some(query => !ctx.sessions.get(query.sessionId))) {
                res.writeHead(404);
                res.end();
                return;
            }
            const subscriptions = new Map(queries.map(query => [careSubscriptionKey(query), {
                    query, dirty: true, failed: false, revision: 0, signature: undefined,
                    rewrites: undefined, cursor: {},
                }]));
            res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
            res.flushHeaders();
            const controller = new AbortController();
            let blocked = false;
            let running = false;
            let scheduled = false;
            let closed = false;
            const close = () => {
                if (closed)
                    return;
                closed = true;
                controller.abort();
                unsubscribe();
                streams.delete(close);
                res.off('drain', drain);
                res.off('close', close);
                res.end();
            };
            const send = (frame) => {
                const text = JSON.stringify(frame) + '\n';
                if (Buffer.byteLength(text) > CARE_FRAME_BYTES)
                    throw new Error('context-care: subscription frame exceeds wire limit');
                if (!res.write(text))
                    blocked = true;
            };
            const flush = async () => {
                if (closed || blocked || running)
                    return;
                running = true;
                try {
                    for (const [key, subscription] of subscriptions) {
                        if (closed || blocked)
                            break;
                        if (!subscription.dirty || subscription.failed)
                            continue;
                        subscription.dirty = false;
                        const { query } = subscription;
                        const envelope = { key, sessionId: query.sessionId, topic: query.topic, revision: subscription.revision + 1 };
                        try {
                            const raw = await read(query, controller.signal);
                            if (closed)
                                break;
                            if (query.topic === 'rewrites') {
                                // The shared owner already validates/normalizes each actual rewrite.
                                // Do not clone, validate or stringify the complete history per subscriber.
                                const cut = rewriteCut(raw);
                                if (!cut)
                                    throw new Error('context-care: rewrite projection unavailable');
                                const initial = subscription.rewrites?.feed !== cut.feed;
                                if (initial)
                                    subscription.cursor = {};
                                const delta = cut.feed.consume(subscription.cursor);
                                if (!initial && !delta.added.length && !delta.removed.length)
                                    continue;
                                if (delta.added.some(record => record.sessionId !== query.sessionId))
                                    throw new Error('context-care: cross-session rewrite');
                                const replaced = new Set(delta.added.map(record => record.hash));
                                send(initial ? { ...envelope, type: 'snapshot', value: { records: [...delta.added] } }
                                    : { ...envelope, type: 'delta', value: { records: [...delta.added],
                                            removed: delta.removed.filter(record => !replaced.has(record.hash)).map(record => record.hash) } });
                                subscription.rewrites = cut;
                                subscription.revision++;
                            }
                            else {
                                // Detach optional fields only for the selected bounded page.
                                const value = Value.parse(JSON.parse(JSON.stringify(raw)));
                                const signature = JSON.stringify(value);
                                if (signature === subscription.signature)
                                    continue;
                                send({ ...envelope, type: 'snapshot', value });
                                subscription.signature = signature;
                                subscription.revision++;
                            }
                        }
                        catch (error) {
                            if (closed)
                                break;
                            subscription.failed = true;
                            ctx.logger.warn('context-care: subscription failed', query, error);
                            send({ ...envelope, type: 'error', error: { name: error instanceof Error ? error.name : 'Error',
                                    message: error instanceof Error ? error.message : String(error) } });
                            subscription.revision++;
                        }
                    }
                }
                finally {
                    running = false;
                }
                if (!closed && !blocked && [...subscriptions.values()].some(value => value.dirty && !value.failed))
                    schedule();
            };
            const schedule = () => {
                if (closed || scheduled || running || blocked)
                    return;
                scheduled = true;
                queueMicrotask(() => {
                    scheduled = false;
                    void flush().catch(error => { ctx.logger.warn('context-care: subscription transport failed', error); close(); });
                });
            };
            const unsubscribe = changes.subscribe(change => {
                for (const subscription of subscriptions.values()) {
                    if ((change.sessionId === undefined || change.sessionId === subscription.query.sessionId)
                        && change.topics.includes(subscription.query.topic))
                        subscription.dirty = true;
                }
                schedule();
            });
            const drain = () => { blocked = false; schedule(); };
            streams.add(close);
            res.on('drain', drain);
            res.on('close', close);
            schedule();
        } });
    return () => { stop(); for (const close of [...streams])
        close(); };
}
//# sourceMappingURL=change-route.js.map