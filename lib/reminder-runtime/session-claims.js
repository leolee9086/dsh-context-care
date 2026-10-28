import { createClaimRuntime } from '@leolee9086/dsh-rule-engine';
import { ensureSessionLog } from '../session-log.js';
/** Native corpus/inbox access only; quota reconciliation and ledger publication belong to the engine. */
export function createSessionClaims(ctx, now = Date.now) {
    const history = ensureSessionLog(ctx);
    const runtime = createClaimRuntime({ cache: history.cache, now,
        getSession: id => ctx.sessions.get(id),
        listSessions: async () => (await history.listSessions()).map(({ header }) => String(header.id)),
        inbox(session) {
            const inbox = ctx.get('sessionProjections')?.stateOf(session, 'inbox');
            if (!inbox)
                throw new Error('reminder-shared-inbox-projection-unavailable');
            return [...inbox['next-turn'], ...inbox['next-step']];
        },
        async read(id) {
            const log = await history.read(id);
            return { length: log.length, prepare: () => log.prepare(), [Symbol.dispose]: () => log[Symbol.dispose](),
                *select(types, fromSeq) {
                    for (const event of log.select(types, fromSeq)) {
                        if (event.type === 'user/message' || event.type === 'agent/inbox/spliced')
                            yield event;
                    }
                },
            };
        },
    });
    return { ...runtime,
        observe(session, event) {
            if (event.type === 'user/message' || event.type === 'agent/inbox/spliced')
                runtime.observe(String(session.id), session, event);
        },
        created: (session) => runtime.created(String(session.id)),
    };
}
//# sourceMappingURL=session-claims.js.map