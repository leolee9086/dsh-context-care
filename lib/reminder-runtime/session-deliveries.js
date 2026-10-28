import { readSnoozeResult, createDeliveryRuntime } from '@leolee9086/dsh-rule-engine';
import { ensureSessionLog } from '../session-log.js';
import { SNOOZE_TOOL } from './snooze.js';
/** Native events are converted without copying their message bodies or replaying a Session. */
function fact(event) {
    switch (event.type) {
        case 'agent/inbox/spliced':
        case 'user/message':
        case 'step/start':
        case 'step/end':
        case 'turn/start':
        case 'turn/end':
        case 'tool/call':
        case 'tool/result':
        case 'tool/ptc-dispatch': return event;
        default: return { type: 'other', seq: event.seq };
    }
}
function nativeLog(log) {
    return { owner: log.owner, length: log.length, inheritedEventCount: log.inheritedEventCount,
        [Symbol.dispose]: () => log[Symbol.dispose](),
        *select(types, fromSeq, toSeqExclusive) {
            for (const event of log.select(types, fromSeq, toSeqExclusive)) {
                const value = fact(event);
                if (value.type !== 'other')
                    yield value;
            }
        },
    };
}
/** The Host owns exact Session identities, immutable cuts, cache generations and native inbox access. */
export function createSessionDeliveries(ctx, now = Date.now) {
    const history = ensureSessionLog(ctx);
    const runtime = createDeliveryRuntime({ cache: history.cache, now,
        snoozeTool: SNOOZE_TOOL, readSnooze: readSnoozeResult,
        getSession: id => ctx.sessions.get(id),
        read: async (id) => nativeLog(await history.read(id)),
        live: session => nativeLog(history.live(session)),
        inbox(id) {
            const agent = ctx.get('agents')?.get(id);
            return [...(agent?.inbox.nextTurn ?? []), ...(agent?.inbox.nextStep ?? [])];
        },
    });
    return { ...runtime, observe: (session, event) => runtime.observe(session, fact(event)) };
}
//# sourceMappingURL=session-deliveries.js.map