const fs = require('fs')
const path = require('path')

const REHYDRATE = 'persist/REHYDRATE'

const keyFilter = ({ whitelist, blacklist } = {}) => (key) =>
    key !== '_persist' &&
    (!whitelist || whitelist.includes(key)) &&
    (!blacklist || !blacklist.includes(key))

// Same shape as redux-persist's createTransform. `inbound` runs before a key is
// written to disk, `outbound` runs on the loaded value before it is merged into state.
const createTransform = (inbound, outbound, config = {}) => {
    const applies = keyFilter(config)
    return {
        in: (value, key) => (inbound && applies(key) ? inbound(value, key) : value),
        out: (value, key) => (outbound && applies(key) ? outbound(value, key) : value)
    }
}

const createFilePersistence = ({
    dir,
    key = 'root',
    whitelist,
    blacklist,
    transforms = [],
    throttle = 30000,
    onError = (err) => console.error('[redux-file-persist]', err)
}) => {
    if (!dir) throw new Error('redux-file-persist: `dir` is required')

    const file = path.join(dir, `${key}.json`)
    const tmpFile = `${file}.tmp`
    const shouldPersist = keyFilter({ whitelist, blacklist })

    const load = () => {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'))
        } catch (err) {
            if (err.code !== 'ENOENT') onError(err)
            return {}
        }
    }

    const save = async (state) => {
        const toSave = Object.fromEntries(
            Object.keys(state)
                .filter(k => shouldPersist(k) && state[k] !== undefined)
                .map(k => [k, transforms.reduce((value, t) => t.in(value, k), state[k])])
        )
        try {
            await fs.promises.mkdir(dir, { recursive: true })
            await fs.promises.writeFile(tmpFile, JSON.stringify(toSave))
            await fs.promises.rename(tmpFile, file)
        } catch (err) {
            onError(err)
            await fs.promises.unlink(tmpFile).catch(() => {})
        }
    }

    const persistReducer = (rootReducer) => (state, action) => {
        // _persist is kept out of the root reducer, because combineReducers warns about unknown keys
        const { _persist, ...rest } = state || {}

        if (action.type === REHYDRATE && action.key === key) {
            const restored = Object.fromEntries(
                Object.keys(action.payload)
                    .filter(k => shouldPersist(k) && action.payload[k] !== undefined)
                    .map(k => [k, transforms.reduceRight((value, t) => t.out(value, k), action.payload[k])])
            )
            return { ...rootReducer({ ...rest, ...restored }, action), _persist: { rehydrated: true } }
        }

        const nextState = rootReducer(_persist ? rest : state, action)
        return _persist ? { ...nextState, _persist } : nextState
    }

    const persistStore = (store) => {
        store.dispatch({ type: REHYDRATE, key, payload: load() })
        try { fs.unlinkSync(tmpFile) } catch {}

        let timer = null
        let current = null
        let dirty = false
        let lastWrite = 0

        const write = () => {
            clearTimeout(timer)
            timer = null
            dirty = false
            lastWrite = Date.now()
            current = save(store.getState()).finally(() => {
                current = null
                if (dirty) schedule()
            })
            return current
        }

        // Writes at most once per `throttle` ms and never runs two writes at once.
        // Changes made during a write are saved by a follow-up write.
        const schedule = () => {
            if (current) { dirty = true; return }
            if (timer) return
            timer = setTimeout(write, Math.max(0, throttle - (Date.now() - lastWrite)))
        }

        const unsubscribe = store.subscribe(schedule)

        const flush = async () => {
            while (current || timer) {
                await (current || write())
            }
        }

        const stop = () => {
            unsubscribe()
            return flush()
        }

        return { flush, stop }
    }

    return { persistReducer, persistStore }
}

module.exports = {
    REHYDRATE,
    createTransform,
    createFilePersistence
}
