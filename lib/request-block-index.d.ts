/** Fields used to locate immutable request blocks during one planning operation. */
export interface RequestBlock {
    id: string;
    view: string;
    callId?: string;
    messageIndex: number;
    path: string;
}
/** Build lookup groups once without copying block payloads or changing source order. */
export declare function indexRequestBlocks<B extends RequestBlock>(blocks: readonly B[]): {
    model: B[];
    byId: Map<string, B>;
    byCall: Map<string, B[]>;
    /** Explicit injection anchors used Array.find, unlike patches whose byId
     * keeps the last id. Build only when requested; preserve the first model
     * block and never borrow a same-named block from another view. */
    firstModel(id: string): B | undefined;
};
/** Preserve the existing stable rightmost-first order without rebuilding ICU
 * collation options for every path comparison. Keep the collator local: each
 * sort observes the current default locale and retains no request data. */
export declare function orderRequestRemovals<B extends RequestBlock>(blocks: readonly B[], filters: ReadonlySet<string>): B[];
/** A removed ancestor already covers its descendants; synthetic results are not parents. */
export declare function filteredAncestor(block: RequestBlock, removed: ReadonlySet<string>): boolean;
