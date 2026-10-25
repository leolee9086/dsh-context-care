/**
 * Reuse an exact policy-token comparison only while its owners report unchanged
 * mutation revisions. Stamps are cheap invalidation hints, never policy tokens:
 * a changed stamp always rechecks the original serialization so unrelated ACKs
 * and remove/re-register cycles retain the original equality semantics.
 * The callback and its predicate are scoped to one synchronous planning pass.
 */
export function withPlanningToken(expected, readStamp, readToken, run) {
    let active = true;
    let previous;
    let matches = false;
    const current = () => {
        if (!active)
            throw new Error('planning-token-pass-closed');
        const next = readStamp();
        if (!previous || previous.length !== next.length || next.some((value, index) => !Object.is(value, previous?.[index]))) {
            // Do not publish a stamp if reading the exact token fails: an explicit
            // retry must observe the same owners again rather than reuse stale success.
            const result = readToken() === expected;
            previous = next;
            matches = result;
        }
        return matches;
    };
    try {
        const result = run(current);
        if (result && typeof result.then === 'function')
            throw new Error('planning-token-pass-must-be-synchronous');
        return result;
    }
    finally {
        active = false;
        previous = undefined;
    }
}
//# sourceMappingURL=planning-token.js.map