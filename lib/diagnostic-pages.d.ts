import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionLog, SessionLogRead } from './session-log.js';
export type DiagnosticRead = Pick<SessionLogRead, 'at'>;
/** Entries are immutable revisions; only the selected page builds bodies. */
export interface DiagnosticEntry<T> {
    id: string;
    order: number;
    seq?: number;
    materialize(log: DiagnosticRead): T;
}
export interface DiagnosticIndex<T> {
    readonly size: number;
    get(id: string): DiagnosticEntry<T> | undefined;
    set(entry: DiagnosticEntry<T>): void;
    delete(id: string): void;
    slice(from: number, to: number): readonly DiagnosticEntry<T>[];
    position(seq: number): number | undefined;
}
/** Sorted metadata only. Binary searches avoid re-sorting unchanged entries. */
export declare function createDiagnosticIndex<T>(): DiagnosticIndex<T>;
/** Keep relation buckets stable across immutable record-list revisions. */
export declare function createDiagnosticRelations<R, K>(keys: (record: R) => readonly K[]): {
    update(records: readonly R[], rekey?: boolean): ReadonlySet<K>;
    get(key: K): readonly R[];
};
interface Projection<T, A> {
    entries: DiagnosticIndex<T>;
    admission?: A;
}
interface PageQuery {
    offset: number;
    limit: number;
    seq?: number;
}
/** HTTP and subscriptions borrow the same owner-scoped Session projection. */
export declare function createDiagnosticPages<R, T, A>(history: SessionLog, types: readonly SessionEvent['type'][], create: () => (records: readonly R[], added: readonly SessionEvent[]) => Projection<T, A>): ((session: Session, records: readonly R[], query: PageQuery) => {
    items: T[];
    admission: A | undefined;
    total: number;
    offset: number;
    selectedFound: boolean | undefined;
    nextOffset: number | null;
}) & {
    close(): void;
};
export {};
