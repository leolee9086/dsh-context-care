import { createOutputStream as createStream } from '@leolee9086/dsh-rule-engine';
/** Native protocol mapping only; the library owns stream limits, clocks and work. */
export function createOutputStream(options) {
    const stream = createStream(options);
    return { ...stream, observe(agent, frame) {
            if (frame.type !== 'chunk')
                return stream.observe(agent, frame);
            const { chunk } = frame;
            stream.observe(agent, { ...frame, chunk: chunk.type === 'text-delta' || chunk.type === 'reasoning-delta'
                    || chunk.type === 'block-start' || chunk.type === 'block-end' ? chunk : null });
        } };
}
//# sourceMappingURL=output-stream.js.map