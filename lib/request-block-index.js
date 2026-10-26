/** Build lookup groups once without copying block payloads or changing source order. */
export function indexRequestBlocks(blocks) {
    const model = [], byId = new Map(), byCall = new Map();
    for (const block of blocks) {
        if (block.view === 'model') {
            model.push(block);
            byId.set(block.id, block);
        }
        const callId = block.callId;
        if (callId) {
            let group = byCall.get(callId);
            if (!group) {
                group = [];
                byCall.set(callId, group);
            }
            group.push(block);
        }
    }
    let anchors;
    return { model, byId, byCall,
        /** Explicit injection anchors used Array.find, unlike patches whose byId
         * keeps the last id. Build only when requested; preserve the first model
         * block and never borrow a same-named block from another view. */
        firstModel(id) {
            if (!anchors) {
                anchors = new Map();
                for (const block of model)
                    if (!anchors.has(block.id))
                        anchors.set(block.id, block);
            }
            return anchors.get(id);
        },
    };
}
/** Preserve the existing stable rightmost-first order without rebuilding ICU
 * collation options for every path comparison. Keep the collator local: each
 * sort observes the current default locale and retains no request data. */
export function orderRequestRemovals(blocks, filters) {
    let compare;
    return blocks.filter(block => filters.has(block.id)).sort((a, b) => b.messageIndex - a.messageIndex
        || (compare ??= new Intl.Collator(undefined, { numeric: true }).compare)(b.path, a.path));
}
/** A removed ancestor already covers its descendants; synthetic results are not parents. */
export function filteredAncestor(block, removed) {
    let end = block.path.lastIndexOf('.');
    while (end >= 0) {
        if (removed.has(JSON.stringify([block.messageIndex, block.path.slice(0, end)])))
            return true;
        end = block.path.lastIndexOf('.', end - 1);
    }
    return false;
}
//# sourceMappingURL=request-block-index.js.map