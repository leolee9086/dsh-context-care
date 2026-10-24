import { SESSION_EVENT_TYPES, SESSION_EVENT_PAYLOAD_SHAPES } from './generated/session-events.js';
const nativeNames = new Set(SESSION_EVENT_TYPES);
/** Custom names select native facts; they do not introduce another event journal. */
export function createCustomEvents(requireNative) {
    const declarations = new Map();
    return {
        has: (name) => declarations.has(name),
        nativeName: (name) => declarations.get(name)?.nativeEvent,
        declared() {
            return { names: new Set(declarations.keys()), shapes: new Map([...declarations].map(([name, item]) => [name, item.shape])) };
        },
        aliases(nativeName) {
            return [...declarations].flatMap(([name, item]) => item.nativeEvent === nativeName ? [name] : []).sort();
        },
        selections(names) {
            return [...new Set(names)].sort().flatMap(name => {
                const nativeEvent = declarations.get(name)?.nativeEvent;
                return nativeEvent === undefined ? [] : [{ name, nativeEvent }];
            });
        },
        register(descriptors) {
            const staged = new Map();
            // Validate the complete declaration before publishing any of its names.
            for (const descriptor of descriptors) {
                const { name, nativeEvent } = descriptor;
                if (typeof name !== 'string' || !name.trim())
                    throw new Error('自定义事件名不能为空');
                if (nativeNames.has(name))
                    throw new Error(`自定义事件不能占用内置事件名 ${name}`);
                if (nativeEvent !== undefined && !nativeNames.has(nativeEvent))
                    throw new Error(`自定义事件 ${name} 的原生事件 ${nativeEvent} 不存在`);
                if (requireNative && nativeEvent === undefined)
                    throw new Error(`自定义事件 ${name} 需要 nativeEvent 原生日志绑定`);
                const nativeShape = nativeEvent === undefined ? undefined : SESSION_EVENT_PAYLOAD_SHAPES[nativeEvent];
                const shape = descriptor.shape ?? nativeShape ?? 'any';
                if (nativeShape !== undefined && JSON.stringify(shape) !== JSON.stringify(nativeShape)) {
                    throw new Error(`自定义事件 ${name} 的载荷结构必须与原生事件 ${nativeEvent} 一致`);
                }
                const existing = staged.get(name) ?? declarations.get(name);
                if (existing && (existing.nativeEvent !== nativeEvent || JSON.stringify(existing.shape) !== JSON.stringify(shape))) {
                    throw new Error(`自定义事件 ${name} 已被声明为另一种载荷结构或原生绑定`);
                }
                staged.set(name, { shape, nativeEvent });
            }
            const owner = {};
            for (const [name, item] of staged) {
                let declaration = declarations.get(name);
                if (!declaration) {
                    declaration = { ...item, owners: new Set() };
                    declarations.set(name, declaration);
                }
                declaration.owners.add(owner);
            }
            return () => {
                for (const name of staged.keys()) {
                    const declaration = declarations.get(name);
                    declaration?.owners.delete(owner);
                    if (declaration?.owners.size === 0)
                        declarations.delete(name);
                }
            };
        },
        /** Only the native resolver or discovery fold can supply this canonical input. */
        project(name, native) {
            const declaration = declarations.get(name);
            if (!declaration?.nativeEvent)
                throw new Error(`自定义事件 ${name} 缺少原生日志绑定`);
            if (native.type !== 'session.event' || native.native?.type !== 'session-event' || native.name !== declaration.nativeEvent) {
                throw new Error(`自定义事件 ${name} 与原生事件不匹配`);
            }
            const callId = `${name}#${native.native.seq}`;
            return { ...native, name, callId, rootCallId: callId };
        },
    };
}
//# sourceMappingURL=custom-events.js.map