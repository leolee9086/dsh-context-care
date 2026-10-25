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
};
/** A removed ancestor already covers its descendants; synthetic results are not parents. */
export declare function filteredAncestor(block: RequestBlock, removed: ReadonlySet<string>): boolean;
