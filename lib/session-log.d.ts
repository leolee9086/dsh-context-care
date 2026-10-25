import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session';
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
/** One immutable log cut. Range readers never materialize the complete event array. */
export interface SessionLogRead extends Disposable {
    readonly header: SessionHeader;
    readonly inheritedEventCount: number;
    readonly length: number;
    /** Compatibility for consumers that genuinely need an entire accepted log. */
    readonly events: readonly SessionEvent[];
    at(seq: number): SessionEvent | undefined;
    last(type: Kind, beforeSeq?: number): SessionEvent | undefined;
    range(fromSeq: number, toSeqExclusive?: number): Iterable<SessionEvent>;
    /** Shared type index; an explicit fromSeq uses only that range, not the old prefix. */
    select(types: readonly Kind[], fromSeq?: number, toSeqExclusive?: number): readonly SessionEvent[];
    /** Reuse the same native prepared Session instead of rebuilding it per consumer. */
    prepare(): Session;
}
/** Public capabilities shared by this plugin's log consumers. */
export interface SessionLog {
    read(id: SessionId, signal?: AbortSignal): Promise<SessionLogRead>;
    live(session: Session): SessionLogRead;
    /**
     * Borrow cached readonly values. Each key owns one projection and result type.
     * Raw values follow event order; projected values follow native surface order
     * and invalidate on contentGeneration. Consumers must not mutate returned data.
     */
    projectSurface<T>(session: Session, key: object, project: (entry: SurfaceEntry) => readonly T[], projected?: boolean): readonly T[];
    /** Project selected immutable events once; older cuts reuse the indexed prefix. */
    projectHistory<T>(session: Session, key: object, types: readonly Kind[], project: (entry: SurfaceEntry) => readonly T[], beforeSeq?: number): IndexedProjection<T>;
    messages(session: Session): readonly Message[];
    origins(session: Session): {
        byId: ReadonlyMap<string, MessageOrigin>;
        system?: MessageOrigin;
    };
    withLive<T>(session: Session, reader: (log: SessionLogRead) => T): T;
    listSessions(signal?: AbortSignal): Promise<readonly {
        header: SessionHeader;
    }[]>;
    close(): void;
}
/**
 * Read only the current surface tail through native message projections. One
 * extra message preserves requestContext's truncation indicator without copying
 * the complete derived transcript. The current result may be excluded by ID.
 */
export declare function sessionMessageTail(session: Session, maxMessages: number, excludeMessageId?: string): ReturnType<Session['deriveMessages']>;
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
