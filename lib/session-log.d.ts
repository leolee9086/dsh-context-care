import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
import { type SessionCache } from './session-cache.js';
type Kind = SessionEvent['type'];
type Message = ReturnType<Session['deriveMessages']>[number];
export interface SurfaceEntry {
    event: SessionEvent;
    turnId: string;
}
export interface MessageOrigin extends SurfaceEntry {
    message: Message;
}
/** A fixed cut over append-only derived values, without copying its prefix. */
export interface IndexedProjection<T> {
    readonly length: number;
    at(index: number): T | undefined;
    slice(from?: number, to?: number): readonly T[];
}
export interface HistoricalContext {
    readonly messages: readonly Message[];
    readonly call?: Extract<SessionEvent, {
        type: 'tool/call';
    }>;
}
/** One immutable log cut. Range readers never materialize the complete event array. */
export interface SessionLogRead extends Disposable {
    readonly header: SessionHeader;
    readonly inheritedEventCount: number;
    /** Cache owner only; consumers must not inspect it or retain the lease through it. */
    readonly owner: object;
    readonly length: number;
    /** Explicit historical reconstruction only; ordinary consumers use indexed ranges. */
    all(signal?: AbortSignal): Promise<readonly SessionEvent[]>;
    at(seq: number): SessionEvent | undefined;
    last(type: Kind | readonly Kind[], beforeSeq?: number): SessionEvent | undefined;
    range(fromSeq: number, toSeqExclusive?: number): Iterable<SessionEvent>;
    /** Shared type index; an explicit fromSeq uses only that range, not the old prefix. */
    select(types: readonly Kind[], fromSeq?: number, toSeqExclusive?: number): readonly SessionEvent[];
    /** Reuse the same native prepared Session instead of rebuilding it per consumer. */
    prepare(): Session;
}
/** Public capabilities shared by this plugin's log consumers. */
export interface SessionLog {
    readonly cache: SessionCache;
    read(id: SessionId, signal?: AbortSignal): Promise<SessionLogRead>;
    live(session: Session): SessionLogRead;
    /** Current surface order, indexed once for each native event type. */
    surfaceEvents(session: Session, type: Kind): IndexedProjection<SessionEvent>;
    lastSurface(session: Session, type: Kind): SessionEvent | undefined;
    /** Interpret one original native event once per content generation. */
    messageAt(session: Session, seq: number): Message | undefined;
    /** Bounded current tail plus one extra message to preserve truncation evidence. */
    tail(session: Session, maxMessages: number, excludeMessageId?: string): readonly Message[];
    /** Restore only the prefix before the requested terminal; serialized readers share its native fold. */
    contextBefore(log: Pick<SessionLogRead, 'owner' | 'at'>, terminal: SessionEvent, maxMessages: number, signal?: AbortSignal): Promise<HistoricalContext>;
    /**
     * Borrow cached readonly values. Each key owns one projection and result type.
     * Raw values follow event order; projected values follow native surface order
     * and invalidate on contentGeneration. Consumers must not mutate returned data.
     */
    projectSurface<T>(session: Session, key: object, project: (entry: SurfaceEntry) => readonly T[], projected?: boolean): readonly T[];
    /** Project selected immutable events once; older cuts reuse the indexed prefix. */
    projectHistory<T>(session: Session, key: object, types: readonly Kind[], project: (entry: SurfaceEntry) => readonly T[], beforeSeq?: number): IndexedProjection<T>;
    /** Prepare one bounded native historical cut; the last cut is reusable. */
    historical(session: Session, beforeSeq: number): Session;
    /** Borrow the native immutable tool-history fold; repeated unchanged cuts do no work. */
    tools(session: Session): ReturnType<Session['toolHistory']>;
    messages(session: Session): readonly Message[];
    origins(session: Session): {
        byId: Pick<ReadonlyMap<string, MessageOrigin>, 'get'>;
        system?: MessageOrigin;
    };
    withLive<T>(session: Session, reader: (log: SessionLogRead) => T): T;
    listSessions(signal?: AbortSignal): Promise<readonly {
        header: SessionHeader;
    }[]>;
    close(): void;
}
/** Host-owned access to native immutable logs; no reminder or delivery state lives here. */
export declare function createSessionLog(ctx: Context): SessionLog;
declare module '@deepseek-ai/cordis' {
    interface Context {
        contextCareSessionLog: SessionLog;
    }
}
/** One service per Host composition, shared by requests, reminders and diagnostics. */
export declare function ensureSessionLog(ctx: Context): SessionLog;
export {};
