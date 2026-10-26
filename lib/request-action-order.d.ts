export interface RequestActionDependency {
    id: string;
    stage: string;
    dependsOn: readonly string[];
}
export interface RequestActionOrder<A> {
    readonly order: readonly A[];
    readonly cycle: boolean;
}
export type RequestActionStages<A> = ReadonlyMap<string, RequestActionOrder<A>>;
/** Immutable action-array projection. Stage filtering, first-id resolution and
 * structural readiness are shared; no event, decision or outcome is retained. */
export declare function indexRequestActions<A extends RequestActionDependency>(actions: readonly A[]): RequestActionStages<A>;
