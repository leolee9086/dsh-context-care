export declare function createCustomEvents(requireNative: boolean): {
    has: (name: string) => boolean;
    nativeName: (name: string) => string | undefined;
    declared(): import("@leolee9086/dsh-rule-engine").DeclaredEvents;
    aliases(nativeName: string): string[];
    selections(names: string[]): {
        name: string;
        nativeEvent: string;
    }[];
    register(descriptors: import("@leolee9086/dsh-rule-engine").CustomEventDescriptor[]): () => void;
    project(name: string, native: import("@leolee9086/dsh-rule-engine").EventValue): import("@leolee9086/dsh-rule-engine").EventValue;
};
