const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createFilePersistence, createTransform, REHYDRATE } = require('..')

const createStore = (reducer) => {
    let state = reducer(undefined, { type: '@@INIT' })
    const listeners = new Set()
    return {
        getState: () => state,
        dispatch: (action) => { state = reducer(state, action); listeners.forEach(l => l()); return action },
        subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) }
    }
}

const rootReducer = (state = { a: 1, b: 'x', c: [] }, action) =>
    action.type === 'set' ? { ...state, ...action.payload } : state

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rfp-'))
const readJson = (dir, key = 'root') => JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8'))

test('writes whitelisted keys and rehydrates them', async () => {
    const dir = tmpDir()
    const p1 = createFilePersistence({ dir, whitelist: ['a', 'c'], throttle: 50 })
    const store1 = createStore(p1.persistReducer(rootReducer))
    const persistor = p1.persistStore(store1)
    assert.deepStrictEqual(store1.getState()._persist, { rehydrated: true })

    store1.dispatch({ type: 'set', payload: { a: 2, b: 'y', c: [1] } })
    await persistor.stop()
    assert.deepStrictEqual(readJson(dir), { a: 2, c: [1] })
    assert.ok(!fs.existsSync(path.join(dir, 'root.json.tmp')))

    const p2 = createFilePersistence({ dir, whitelist: ['a', 'c'] })
    const store2 = createStore(p2.persistReducer(rootReducer))
    await p2.persistStore(store2).stop()
    assert.deepStrictEqual(store2.getState(), { a: 2, b: 'x', c: [1], _persist: { rehydrated: true } })
})

test('without a whitelist persists everything except blacklist and _persist', async () => {
    const dir = tmpDir()
    const p = createFilePersistence({ dir, blacklist: ['b'] })
    const store = createStore(p.persistReducer(rootReducer))
    const persistor = p.persistStore(store)
    store.dispatch({ type: 'set', payload: { a: 0 } })
    await persistor.stop()
    assert.deepStrictEqual(readJson(dir), { a: 0, c: [] })
})

test('transforms run inbound in order and outbound in reverse', async () => {
    const dir = tmpDir()
    const transforms = [
        createTransform(v => v * 10, v => v / 10, { whitelist: ['a'] }),
        createTransform(v => v + 1, v => v - 1, { whitelist: ['a'] })
    ]
    const p = createFilePersistence({ dir, transforms })
    const store = createStore(p.persistReducer(rootReducer))
    const persistor = p.persistStore(store)
    store.dispatch({ type: 'set', payload: { a: 5 } })
    await persistor.stop()
    assert.strictEqual(readJson(dir).a, 51)
    assert.strictEqual(readJson(dir).b, 'x')

    const p2 = createFilePersistence({ dir, transforms })
    const store2 = createStore(p2.persistReducer(rootReducer))
    await p2.persistStore(store2).stop()
    assert.strictEqual(store2.getState().a, 5)
})

test('throttles writes and saves changes made during a write', async () => {
    const dir = tmpDir()
    const p = createFilePersistence({ dir, throttle: 100 })
    const store = createStore(p.persistReducer(rootReducer))
    const persistor = p.persistStore(store)
    store.dispatch({ type: 'set', payload: { a: 1 } })
    store.dispatch({ type: 'set', payload: { a: 2 } })
    await new Promise(r => setTimeout(r, 20))
    store.dispatch({ type: 'set', payload: { a: 3 } })
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(readJson(dir).a, 2)
    await persistor.flush()
    assert.strictEqual(readJson(dir).a, 3)
    persistor.stop()
})

test('ignores REHYDRATE for other keys and reports corrupt files', async () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, 'root.json'), '{not json')
    const errors = []
    const p = createFilePersistence({ dir, onError: e => errors.push(e) })
    const store = createStore(p.persistReducer(rootReducer))
    await p.persistStore(store).stop()
    assert.strictEqual(errors.length, 1)

    store.dispatch({ type: REHYDRATE, key: 'other', payload: { a: 99 } })
    assert.strictEqual(store.getState().a, 1)
})
