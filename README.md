# redux-file-persist

Persist and rehydrate Redux state to a JSON file in Node.js. A small, dependency-free
replacement for `redux-persist` + `redux-persist-node-storage`.

- Writes atomically (temp file + rename), so a crash mid-write never corrupts the saved state.
- Throttled writes, never overlapping; changes made during a write are picked up by the next one.
- Rehydrates synchronously when `persistStore` is called.
- `createTransform` and the `persist/REHYDRATE` action / `_persist.rehydrated` flag work like redux-persist's.

## Install

```sh
npm install @jclanker/redux-file-persist
```

## Usage

```js
const path = require('path')
const { createStore, combineReducers } = require('redux')
const { createFilePersistence, createTransform } = require('@jclanker/redux-file-persist')

const { persistReducer, persistStore } = createFilePersistence({
    dir: path.resolve(__dirname, 'storage'),   // required
    key: 'root',                               // file name: <dir>/<key>.json
    whitelist: ['settings', 'cache'],          // omit to persist every key
    throttle: 30000
})

const store = createStore(persistReducer(combineReducers({ settings, cache, session })))
const persistor = persistStore(store)

process.on('SIGINT', async () => {
    await persistor.stop()   // write pending changes and stop persisting
    process.exit()
})
```

### Transforms

```js
const dropTemporary = createTransform(
    (state) => ({ ...state, temporary: undefined }),   // before saving
    (state) => ({ ...state, temporary: {} }),          // after loading
    { whitelist: ['cache'] }
)

createFilePersistence({ dir, transforms: [dropTemporary] })
```

Inbound transforms run in array order and outbound transforms run in reverse order.

### Waiting for rehydration

Rehydration happens during `persistStore(store)`. Code that runs earlier (e.g. a saga started
before it) can check `state._persist?.rehydrated` or wait for the `REHYDRATE` action:

```js
const { REHYDRATE } = require('@jclanker/redux-file-persist')

if (!(yield select(s => s._persist?.rehydrated))) yield take(REHYDRATE)
```

## API

### `createFilePersistence(config)`

| option       | default          | description                                                              |
|--------------|------------------|--------------------------------------------------------------------------|
| `dir`        | required         | Directory for the state file (created if missing).                       |
| `key`        | `'root'`         | File name, and the `key` on the `REHYDRATE` action.                      |
| `whitelist`  | all keys         | Top-level state keys to persist.                                         |
| `blacklist`  | none             | Top-level state keys to exclude.                                         |
| `transforms` | `[]`             | Transforms created with `createTransform`.                               |
| `throttle`   | `30000`          | Minimum milliseconds between writes.                                     |
| `onError`    | `console.error`  | Called with write errors and unreadable or corrupt state files.         |

Returns `{ persistReducer, persistStore }`:

- `persistReducer(rootReducer)` wraps your root reducer so it handles rehydration.
- `persistStore(store)` loads the saved state and starts saving changes. Returns:
  - `flush()`: writes pending changes now. Resolves when they are on disk.
  - `stop()`: unsubscribes from the store, then flushes.

### `createTransform(inbound, outbound, { whitelist, blacklist })`

`inbound(value, key)` runs before saving and `outbound(value, key)` runs after loading.
Either one can be `null`.

### `REHYDRATE`

The action type, `'persist/REHYDRATE'`.

## Notes

- Rehydration replaces each saved top-level key as a whole (redux-persist's `autoMergeLevel1`).
- The state must be JSON-serializable. Keys whose value is `undefined` are not saved.
- If the file can't be parsed, `onError` is called and the store starts from its initial state.
  The next write overwrites the file.
