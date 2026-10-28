import { createOutputProjection as createProjection } from '@leolee9086/dsh-rule-engine';
export function createOutputProjection(...args) {
    const projection = createProjection(...args);
    return { ...projection, get deadline() { return projection.deadline; },
        push(at, chunk) {
            if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'block-start' || chunk.type === 'block-end')
                return projection.push(at, chunk);
            return projection.advance(at);
        },
    };
}
//# sourceMappingURL=output-projection.js.map