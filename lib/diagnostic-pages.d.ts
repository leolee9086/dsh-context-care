import type { Session, SessionEvent } from '@deepseek-ai/dsh-session';
import type { SessionLog, SessionLogRead } from './session-log.js';
export declare const compareDiagnosticRecords: (left: {
    at: number;
    key: string;
}, right: {
    at: number;
    key: string;
}) => number;
export interface DiagnosticRecordDelta<R> {
    readonly added: readonly R[];
    readonly removed: readonly R[];
    readonly order?: readonly R[];
}
export interface DiagnosticRecordFeed<R> {
    consume(cursor: object): DiagnosticRecordDelta<R>;
}
export type DiagnosticRecords<R> = readonly R[] | DiagnosticRecordFeed<R>;
export type DiagnosticRecordInput<R> = readonly R[] | DiagnosticRecordDelta<R>;
export declare const isDiagnosticDelta: <R>(records: DiagnosticRecordInput<R>) => records is DiagnosticRecordDelta<R>;
/** The owning Session cache contains this feed. Consumers hold only their cursor;
 * weak readers cannot retain disposed page projections or abandoned subscriptions.
 * Coalesce pending edits by record identity instead of retaining a revision log. */
export declare function createDiagnosticRecordFeed<R>(compare: (left: R, right: R) => number): {
    set(id: string, record: R): void;
    delete(id: string): void;
    snapshot(): readonly R[];
    consume(cursor: object): DiagnosticRecordDelta<R>;
};
/** Whole-list compatibility callers may replace arrays; production passes deltas. */
export declare function createDiagnosticRecordChanges<R>(): (records: DiagnosticRecordInput<R>) => DiagnosticRecordDelta<R>;
/** Sorted scalar candidates. Updates inspect only changed records; array shifts
 * move references but never re-parse or re-sort the complete historical list. */
export declare function createDiagnosticOrder<R>(compare: (left: R, right: R) => number): {
    update(delta: DiagnosticRecordDelta<R>): void;
    last(): R | undefined;
};
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
export declare function createDiagnosticRelations<R, K>(keys: (record: R) => readonly K[], compare?: (left: R, right: R) => number): {
    update(records: DiagnosticRecordInput<R>, rekey?: boolean): ReadonlySet<K>;
    rekey(records: Iterable<R>): ReadonlySet<K>;
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
export declare function createDiagnosticPages<R, T, A>(history: SessionLog, types: readonly SessionEvent['type'][], create: () => (records: DiagnosticRecordInput<R>, added: readonly SessionEvent[]) => Projection<T, A>): ((session: Session, records: DiagnosticRecords<R>, query: PageQuery) => {
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
