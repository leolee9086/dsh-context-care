/**
 * Detach a message's payload once before visiting its block paths. Parent raw
 * evidence and descendant raw evidence may share this owned tree: the planning
 * projection freezes it before publication. Never borrow the writable request
 * or clone each descendant subtree again; nested tool results otherwise copy
 * the same payload once per ancestor. Parsed arguments remain separately owned.
 */
export declare function ownRequestMessageBody<C, S>(message: {
    content: C;
    source?: S;
}): {
    content: C;
    source: S | undefined;
};
