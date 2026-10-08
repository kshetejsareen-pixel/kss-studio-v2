// IndexedDB storage. `kv` holds JSON records (settings, the workspace list, one document
// per workspace); `blobs` holds image data as { full, thumb } Blobs keyed by image id.
// IndexedDB has far more room than localStorage and is not wiped when one write fails.
const DB_NAME = 'kss-studio'
const DB_VERSION = 1

let dbPromise = null

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store data (IndexedDB is unavailable).'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
    }
    req.onsuccess = () => {
      const db = req.result
      // A newer version opened in another tab: let it upgrade, reconnect on next use.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      db.onclose = () => {
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error || new Error('Could not open storage.'))
    }
  })
  return dbPromise
}

export const reqP = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Storage write was aborted.'))
  })

async function tx(storeName, mode) {
  const db = await open()
  const t = db.transaction(storeName, mode)
  return { t, store: t.objectStore(storeName) }
}

// ---- kv --------------------------------------------------------------------------

export async function kvGet(key) {
  const { store } = await tx('kv', 'readonly')
  return reqP(store.get(key))
}

export async function kvSet(key, value) {
  const { t, store } = await tx('kv', 'readwrite')
  store.put(value, key)
  return done(t)
}

// Several records in one transaction: all are written or none are.
export async function kvSetMany(entries) {
  const { t, store } = await tx('kv', 'readwrite')
  for (const [key, value] of entries) store.put(value, key)
  return done(t)
}

export async function kvDel(key) {
  const { t, store } = await tx('kv', 'readwrite')
  store.delete(key)
  return done(t)
}

export async function kvKeys() {
  const { store } = await tx('kv', 'readonly')
  return reqP(store.getAllKeys())
}

// ---- blobs -----------------------------------------------------------------------

export async function blobPut(id, record) {
  const { t, store } = await tx('blobs', 'readwrite')
  store.put(record, id)
  return done(t)
}

export async function blobPutMany(entries) {
  const { t, store } = await tx('blobs', 'readwrite')
  for (const [id, record] of entries) store.put(record, id)
  return done(t)
}

export async function blobGet(id) {
  const { store } = await tx('blobs', 'readonly')
  return reqP(store.get(id))
}

export async function blobDel(ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  if (!list.length) return
  const { t, store } = await tx('blobs', 'readwrite')
  for (const id of list) store.delete(id)
  return done(t)
}

export async function blobKeys() {
  const { store } = await tx('blobs', 'readonly')
  return reqP(store.getAllKeys())
}

// ---- quota -----------------------------------------------------------------------

// Asks the browser not to evict this site's data under storage pressure.
export async function persist() {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function isPersisted() {
  try {
    return (await navigator.storage?.persisted?.()) || false
  } catch {
    return false
  }
}

export async function usage() {
  try {
    const est = await navigator.storage?.estimate?.()
    return { usage: est?.usage || 0, quota: est?.quota || 0 }
  } catch {
    return { usage: 0, quota: 0 }
  }
}
