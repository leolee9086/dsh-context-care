import { createOutputProjection } from './output-projection.js';
/** Bounded live scheduling around the same timestamp fold used by native replay. */
export function createOutputStream({ config, submit, afterSubmit, report, enabled, sessionId: identify, attemptId: identifyAttempt }) {
    const active = new Map(), pending = new Set();
    let closed = false, pendingBytes = 0;
    const maxPending = config.maxStreamPending ?? 32, maxPendingBytes = config.maxStreamPendingBytes ?? 4194304;
    function consume(entry, events) {
        for (const event of events) {
            if (closed || entry.overflowed)
                return;
            const bytes = Buffer.byteLength(JSON.stringify(event));
            if (pending.size >= maxPending || pendingBytes + bytes > maxPendingBytes) {
                entry.overflowed = true;
                entry.projection.stop();
                clearTimeout(entry.timer);
                report(new Error(`reminder-stream-pending-budget-exceeded: session=${entry.sessionId}, attempt=${entry.attemptId}`));
                return;
            }
            pendingBytes += bytes;
            const task = submit(event).then(() => {
                if (active.get(entry.sessionId) === entry)
                    return afterSubmit(entry.agent, event.output);
            }).catch(report).finally(() => { pending.delete(task); pendingBytes -= bytes; });
            pending.add(task);
        }
    }
    function schedule(entry) {
        const at = entry.projection.deadline;
        if (at === entry.timerAt)
            return;
        clearTimeout(entry.timer);
        entry.timer = undefined;
        entry.timerAt = at;
        if (at === undefined || entry.overflowed)
            return;
        entry.timer = setTimeout(() => {
            entry.timer = undefined;
            entry.timerAt = undefined;
            consume(entry, entry.projection.advance(at));
            schedule(entry);
        }, Math.max(0, at - Date.now()));
    }
    function observe(agent, frame) {
        if (closed)
            return;
        const sessionId = identify(agent);
        if (frame.type === 'start') {
            const old = active.get(sessionId);
            if (old)
                clearTimeout(old.timer);
            active.delete(sessionId);
            if (!enabled(sessionId))
                return;
            const attemptId = identifyAttempt?.(agent) ?? frame.attemptId;
            active.set(sessionId, { agent, sessionId, liveAttemptId: frame.attemptId, attemptId, revision: frame.revision,
                projection: createOutputProjection(config, { sessionId, attemptId, turn: frame.turn, step: frame.step }, report), overflowed: false });
            return;
        }
        const entry = active.get(sessionId);
        if (!entry || entry.liveAttemptId !== frame.attemptId || frame.revision <= entry.revision)
            return;
        entry.revision = frame.revision;
        if (frame.type === 'end') {
            clearTimeout(entry.timer);
            consume(entry, entry.projection.finish(frame.time));
            active.delete(sessionId);
        }
        else {
            consume(entry, entry.projection.push(frame.time, frame.chunk));
            schedule(entry);
        }
    }
    return {
        observe,
        /** No committed stream exists for abandonment; it cannot supply complete evidence. */
        abandon(agent, frame) {
            const entry = active.get(identify(agent));
            if (!entry || entry.liveAttemptId !== frame.attemptId || frame.revision <= entry.revision)
                return;
            clearTimeout(entry.timer);
            active.delete(entry.sessionId);
        },
        isCurrent(agent, output) { return active.get(identify(agent))?.attemptId === output.attemptId; },
        async close() {
            closed = true;
            for (const entry of active.values())
                clearTimeout(entry.timer);
            active.clear();
            await Promise.allSettled([...pending]);
        },
    };
}
//# sourceMappingURL=output-stream.js.map