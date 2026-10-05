import type { Reducer, Store } from 'redux'

export declare const REHYDRATE: 'persist/REHYDRATE'

export interface KeyFilter {
    whitelist?: string[]
    blacklist?: string[]
}

export interface Transform {
    in: (value: any, key: string) => any
    out: (value: any, key: string) => any
}

export declare function createTransform(
    inbound?: ((value: any, key: string) => any) | null,
    outbound?: ((value: any, key: string) => any) | null,
    config?: KeyFilter
): Transform

export interface FilePersistenceConfig extends KeyFilter {
    dir: string
    key?: string
    transforms?: Transform[]
    throttle?: number
    onError?: (err: unknown) => void
}

export interface Persistor {
    flush: () => Promise<void>
    stop: () => Promise<void>
}

export declare function createFilePersistence(config: FilePersistenceConfig): {
    persistReducer: <S, A extends { type: string }>(rootReducer: Reducer<S, A>) => Reducer<S & { _persist?: { rehydrated: boolean } }, A>
    persistStore: (store: Store) => Persistor
}
