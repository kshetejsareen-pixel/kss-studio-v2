// The app's single store: settings, the workspace list, the active workspace document,
// thumbnails, the server session, routing and toasts. Everything is saved to IndexedDB.
// Boot and the tab lock live at module level so React StrictMode's double effects are safe.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { kvGet, kvSet, kvSetMany, kvDel, persist } from '../data/db.js'
import { DEFAULT_SETTINGS, ROUTES, emptyDoc, normalizeDoc } from '../data/model.js'
import { processFile, storeImages, loadThumbs, deleteImageData, releaseAll } from '../data/media.js'
import { hasV2Data, readV2, migrateSettings, migrateDoc, migrationMessage } from '../data/migrate.js'
import { buildBackup, backupFilename, readBackup, restoreBackup } from '../data/backup.js'
import { runtime, setRuntimeSettings, setRuntimeSession, on } from '../lib/runtime.js'
import { metaStatus } from '../lib/meta.js'
import { modelLabel } from '../lib/api.js'
import { hamming, DUPLICATE_DISTANCE } from '../lib/image.js'
import { mapLimit } from '../lib/pool.js'
import { downloadBlob } from '../lib/download.js'
import { acquirePrimary, takeOver as stealLock } from '../lib/tablock.js'
import { uid } from '../lib/ids.js'

const StoreContext = createContext(null)

export const useStore = () => useContext(StoreContext)

// ---- Boot (module level, runs once) ----------------------------------------------------

let bootPromise = null

async function bootData() {
  persist()
  let settings = { ...DEFAULT_SETTINGS, ...((await kvGet('settings')) || {}) }
  let workspaces = (await kvGet('workspaces')) || []
  const meta = (await kvGet('meta')) || {}
  if (!meta.createdAt) meta.createdAt = new Date().toISOString()
  if (!workspaces.length) {
    const now = new Date().toISOString()
    const ws = { id: uid('w'), name: 'Main', createdAt: now, updatedAt: now }
    workspaces = [ws]
    await kvSetMany([['workspaces', workspaces], [`ws:${ws.id}`, emptyDoc()], ['activeWorkspace', ws.id], ['meta', meta]])
  }
  let activeId = await kvGet('activeWorkspace')
  if (!workspaces.some((w) => w.id === activeId)) activeId = workspaces[0].id
  let doc = normalizeDoc(await kvGet(`ws:${activeId}`))
  let migrated = null
  if (!meta.migratedV2 && hasV2Data()) {
    const v2 = readV2()
    settings = migrateSettings(v2, settings)
    const result = await migrateDoc(v2, doc)
    doc = result.doc
    migrated = result.summary
    meta.migratedV2 = new Date().toISOString()
    await kvSetMany([['settings', settings], [`ws:${activeId}`, doc], ['meta', meta]])
  }
  return { settings, workspaces, activeId, doc, meta, migrated }
}

const boot = () => (bootPromise ||= bootData())

// ---- Session ---------------------------------------------------------------------------

// Any non-JSON reply (static hosting, plain `vite` without the API) means browser-only mode.
async function sessionRequest(method = 'GET', body) {
  try {
    const res = await fetch('/api/session', {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!(res.headers.get('content-type') || '').includes('json')) return { server: false, status: res.status }
    const data = await res.json()
    return { ...data, status: res.status }
  } catch {
    return { server: false, status: 0 }
  }
}

function modesFor(s, skipServer) {
  const live = s.server && s.authed && !skipServer
  const f = s.features || {}
  return {
    server: !!s.server,
    authed: !!s.authed,
    claudeMode: live && f.claude ? 'server' : 'legacy',
    metaMode: live && f.meta ? 'server' : 'legacy',
    cloudMode: live && f.cloudinary ? 'server' : 'legacy',
  }
}

// ---- Routing ---------------------------------------------------------------------------

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [path, query = ''] = raw.split('?')
  const step = ROUTES.includes(path) ? path : 'brief'
  return { step, params: Object.fromEntries(new URLSearchParams(query)) }
}

const SKIP_KEY = 'kss_skip_server'
const readSkip = () => {
  try { return sessionStorage.getItem(SKIP_KEY) === '1' } catch { return false }
}

// ---- Provider --------------------------------------------------------------------------

export function StoreProvider({ children }) {
  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [workspaces, setWorkspaces] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [doc, setDoc] = useState(emptyDoc)
  const [savedAt, setSavedAt] = useState(null)
  const [thumbs, setThumbs] = useState({})
  const [missing, setMissing] = useState([])
  const [session, setSession] = useState({ checked: false, server: false, authed: false, needsPasscode: false, features: {} })
  const [skipServer, setSkipServer] = useState(readSkip)
  const [route, setRoute] = useState(parseHash)
  const [toasts, setToasts] = useState([])
  const [isPrimary, setIsPrimary] = useState(true)
  const [meta, setMeta] = useState({})
  const [metaState, setMetaState] = useState(null)

  const docRef = useRef(doc)
  const settingsRef = useRef(settings)
  const activeRef = useRef(null)
  const primaryRef = useRef(true)
  const dirty = useRef(false)
  const saveTimer = useRef(null)
  const settingsTimer = useRef(null)
  const saveErrorShown = useRef(false)
  const fallbackShown = useRef(false)

  // ---- Toasts ----
  const dismissToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const toast = useCallback((message, opts = {}) => {
    const id = uid('t')
    const kind = opts.kind || 'info'
    setToasts((list) => [...list.slice(-3), { id, message, kind, action: opts.action || null }])
    const ms = opts.duration ?? (kind === 'error' ? 7000 : opts.action ? 6000 : 3500)
    if (ms > 0) setTimeout(() => dismissToast(id), ms)
    return id
  }, [dismissToast])

  // ---- Saving ----
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current)
    if (!dirty.current || !primaryRef.current || !activeRef.current) return
    dirty.current = false
    try {
      await kvSet(`ws:${activeRef.current}`, docRef.current)
      setSavedAt(Date.now())
      saveErrorShown.current = false
    } catch {
      dirty.current = true
      if (!saveErrorShown.current) {
        saveErrorShown.current = true
        toast('Couldn’t save — storage full?', { kind: 'error' })
      }
    }
  }, [toast])

  const scheduleSave = useCallback(() => {
    dirty.current = true
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 800)
  }, [flush])

  // update(fn) or update(patch). Successive calls in one tick compose through docRef.
  const update = useCallback((fnOrPatch) => {
    const prev = docRef.current
    const next = typeof fnOrPatch === 'function' ? fnOrPatch(prev) : { ...prev, ...fnOrPatch }
    if (!next || next === prev) return
    docRef.current = next
    setDoc(next)
    scheduleSave()
  }, [scheduleSave])

  const getDoc = useCallback(() => docRef.current, [])

  const updateSettings = useCallback((patch) => {
    const next = { ...settingsRef.current, ...(typeof patch === 'function' ? patch(settingsRef.current) : patch) }
    settingsRef.current = next
    setSettings(next)
    setRuntimeSettings(next)
    clearTimeout(settingsTimer.current)
    settingsTimer.current = setTimeout(() => {
      kvSet('settings', settingsRef.current).catch(() => toast('Couldn’t save settings — storage full?', { kind: 'error' }))
    }, 400)
  }, [toast])

  // ---- Thumbnails ----
  const loadAllThumbs = useCallback(async (images) => {
    const ids = images.map((i) => i.id)
    const lost = await loadThumbs(ids, (part) => setThumbs((t) => ({ ...t, ...part })))
    setMissing(lost)
  }, [])

  const openDoc = useCallback(async (id, loaded) => {
    const next = loaded || normalizeDoc(await kvGet(`ws:${id}`))
    activeRef.current = id
    docRef.current = next
    dirty.current = false
    setActiveId(id)
    setDoc(next)
    setThumbs({})
    setMissing([])
    loadAllThumbs(next.images)
    return next
  }, [loadAllThumbs])

  // ---- Session ----
  const applySession = useCallback((s, skip = skipServer) => {
    const next = {
      checked: true,
      server: !!s.server,
      authed: !!s.authed,
      needsPasscode: !!s.server && !s.authed,
      features: s.features || {},
    }
    setSession(next)
    setRuntimeSession(modesFor(next, skip))
    return next
  }, [skipServer])

  const refreshSession = useCallback(async () => applySession(await sessionRequest('GET')), [applySession])

  const login = useCallback(async (passcode) => {
    const res = await sessionRequest('POST', { passcode })
    if (res.status === 200 && res.authed) {
      try { sessionStorage.removeItem(SKIP_KEY) } catch { /* ignore */ }
      setSkipServer(false)
      applySession(res, false)
      return { ok: true }
    }
    return { ok: false, error: res.error || (res.status ? `Sign-in failed (${res.status}).` : 'Could not reach the studio server.') }
  }, [applySession])

  const logout = useCallback(async () => {
    await sessionRequest('DELETE')
    applySession({ server: true, authed: false })
  }, [applySession])

  const useWithoutServer = useCallback(() => {
    try { sessionStorage.setItem(SKIP_KEY, '1') } catch { /* ignore */ }
    setSkipServer(true)
    setRuntimeSession(modesFor(session, true))
  }, [session])

  const refreshMeta = useCallback(async () => {
    const s = settingsRef.current
    if (runtime.session.metaMode !== 'server' && !s.metaToken) {
      setMetaState(null)
      return null
    }
    const status = await metaStatus()
    setMetaState(status)
    return status
  }, [])

  // ---- Boot ----
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [data, s] = await Promise.all([boot(), sessionRequest('GET')])
        if (!alive) return
        settingsRef.current = data.settings
        setSettings(data.settings)
        setRuntimeSettings(data.settings)
        setWorkspaces(data.workspaces)
        setMeta(data.meta)
        applySession(s)
        await openDoc(data.activeId, data.doc)
        setReady(true)
        if (data.migrated) toast(migrationMessage(data.migrated), { kind: 'success', duration: 9000 })
      } catch (err) {
        if (alive) setBootError(err?.message || 'Could not open storage.')
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Meta status once the session is known.
  useEffect(() => {
    if (ready && session.checked) refreshMeta()
  }, [ready, session.checked, session.authed, skipServer, settings.metaToken, refreshMeta])

  // Theme on <html>.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark'
  }, [settings.theme])

  // Hash routing.
  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = useCallback((step, params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
    const hash = `#/${step}${q ? `?${q}` : ''}`
    if (window.location.hash !== hash) window.location.hash = hash
    else setRoute(parseHash())
  }, [])

  // Flush on hide and unload.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    const onLeave = () => { flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onLeave)
    window.addEventListener('beforeunload', onLeave)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onLeave)
      window.removeEventListener('beforeunload', onLeave)
    }
  }, [flush])

  // Tab lock: only the primary tab saves and publishes.
  useEffect(() => acquirePrimary((primary) => {
    const was = primaryRef.current
    primaryRef.current = primary
    setIsPrimary(primary)
    // Regained the lock: another tab may have changed the workspace meanwhile.
    if (primary && !was && activeRef.current) openDoc(activeRef.current)
  }), [openDoc])

  const takeOver = useCallback(() => stealLock(), [])

  // Library events from the API helpers.
  useEffect(() => {
    const offAuth = on('kss:unauthed', () => {
      setSession((s) => ({ ...s, authed: false, needsPasscode: true }))
      setRuntimeSession({ authed: false, claudeMode: 'legacy', metaMode: 'legacy', cloudMode: 'legacy' })
      toast('Your session ended — enter the passcode again.', { kind: 'error' })
    })
    const offFallback = on('kss:fallback', (fb) => {
      if (fallbackShown.current) return
      fallbackShown.current = true
      toast(`${modelLabel(fb?.from)} was busy, so ${modelLabel(fb?.to)} answered instead.`)
    })
    return () => { offAuth(); offFallback() }
  }, [toast])

  // ---- Images ----
  // Stores processed images: re-links missing images by file name, flags near-duplicates.
  const addProcessed = useCallback(async (entries) => {
    if (!entries.length) return { added: 0, relinked: 0, duplicates: 0 }
    const current = docRef.current.images
    const lost = new Set(missing)
    const byName = new Map(current.filter((i) => lost.has(i.id)).map((i) => [i.name, i]))
    const relinked = []
    const fresh = []
    let duplicates = 0
    for (const e of entries) {
      const old = byName.get(e.image.name)
      if (old) {
        byName.delete(e.image.name)
        relinked.push({ image: { ...old, width: e.image.width, height: e.image.height, orientation: e.image.orientation, bytes: e.image.bytes, palette: e.image.palette, brightness: e.image.brightness, contrast: e.image.contrast, warmth: e.image.warmth, phash: e.image.phash }, record: e.record })
        continue
      }
      const pool = [...current, ...fresh.map((f) => f.image)]
      const twin = e.image.phash && pool.find((i) => i.phash && !i.role && hamming(i.phash, e.image.phash) <= DUPLICATE_DISTANCE)
      if (twin && !e.image.role) {
        e.image.dupOf = twin.id
        duplicates++
      }
      fresh.push(e)
    }
    const urls = await storeImages([...relinked, ...fresh])
    setThumbs((t) => ({ ...t, ...urls }))
    if (relinked.length) {
      const ids = new Set(relinked.map((r) => r.image.id))
      setMissing((m) => m.filter((id) => !ids.has(id)))
    }
    const patched = new Map(relinked.map((r) => [r.image.id, r.image]))
    update((d) => ({ ...d, images: [...d.images.map((i) => patched.get(i.id) || i), ...fresh.map((f) => f.image)] }))
    return { added: fresh.length, relinked: relinked.length, duplicates, ids: fresh.map((f) => f.image.id) }
  }, [missing, update])

  const addImageFiles = useCallback(async (files, extra = {}, { onProgress, signal } = {}) => {
    const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(f.name))
    if (!list.length) {
      toast('No images in that selection.', { kind: 'error' })
      return null
    }
    let done = 0
    const settled = await mapLimit(list, 3, async (file) => {
      const out = await processFile(file, extra)
      done++
      onProgress?.(done, list.length)
      return out
    }, { signal })
    const entries = settled.filter((r) => r.value).map((r) => r.value)
    const errors = settled.map((r, i) => (r.error ? `${list[i].name}: ${r.error.message}` : null)).filter(Boolean)
    const result = await addProcessed(entries)
    const parts = []
    if (result.added) parts.push(`${result.added} added`)
    if (result.relinked) parts.push(`${result.relinked} re-linked`)
    if (result.duplicates) parts.push(`${result.duplicates} look like duplicates`)
    if (errors.length) parts.push(`${errors.length} couldn’t be read`)
    toast(parts.join(' · ') || 'Nothing imported.', { kind: errors.length && !entries.length ? 'error' : 'success' })
    return { ...result, errors }
  }, [addProcessed, toast])

  // Removes images and every reference to them. Drive ids are remembered so a re-import
  // of the same folder doesn't bring them back.
  const deleteImages = useCallback(async (ids) => {
    const gone = new Set(ids)
    update((d) => {
      const driveIds = d.images.filter((i) => gone.has(i.id) && i.driveId).map((i) => i.driveId)
      return {
        ...d,
        images: d.images.filter((i) => !gone.has(i.id)),
        shortlist: d.shortlist.filter((id) => !gone.has(id)),
        excludedNames: [...new Set([...d.excludedNames, ...driveIds])],
        references: d.references.map((r) => (gone.has(r.imageId) ? { ...r, imageId: null } : r)),
        themes: d.themes.map((k) => ({ ...k, refImageIds: (k.refImageIds || []).filter((id) => !gone.has(id)) })),
        posts: d.posts.map((p) => {
          const slides = p.slides.filter((s) => !gone.has(s.imageId))
          const design = p.design && gone.has(p.design.exportImageId) ? { ...p.design, exportImageId: null } : p.design
          return slides.length === p.slides.length && design === p.design ? p : { ...p, slides, design }
        }),
      }
    })
    setThumbs((t) => {
      const next = { ...t }
      ids.forEach((id) => delete next[id])
      return next
    })
    await deleteImageData(ids)
  }, [update])

  // ---- Workspaces ----
  const saveWorkspaces = useCallback(async (list) => {
    setWorkspaces(list)
    await kvSet('workspaces', list)
  }, [])

  const switchWorkspace = useCallback(async (id) => {
    if (id === activeRef.current) return
    await flush()
    releaseAll()
    await kvSet('activeWorkspace', id)
    await openDoc(id)
  }, [flush, openDoc])

  const createWorkspace = useCallback(async (name) => {
    await flush()
    const now = new Date().toISOString()
    const ws = { id: uid('w'), name: name?.trim() || 'Untitled', createdAt: now, updatedAt: now }
    await kvSet(`ws:${ws.id}`, emptyDoc())
    await saveWorkspaces([...workspaces, ws])
    await switchWorkspace(ws.id)
    return ws
  }, [flush, saveWorkspaces, switchWorkspace, workspaces])

  const renameWorkspace = useCallback((id, name) =>
    saveWorkspaces(workspaces.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name, updatedAt: new Date().toISOString() } : w))),
  [saveWorkspaces, workspaces])

  const deleteWorkspace = useCallback(async (id) => {
    if (workspaces.length < 2) return
    const target = await kvGet(`ws:${id}`)
    const rest = workspaces.filter((w) => w.id !== id)
    if (id === activeRef.current) await switchWorkspace(rest[0].id)
    await saveWorkspaces(rest)
    await kvDel(`ws:${id}`)
    const ids = (target?.images || []).map((i) => i.id)
    if (ids.length) await deleteImageData(ids)
  }, [saveWorkspaces, switchWorkspace, workspaces])

  // ---- Backup ----
  const backup = useCallback(async ({ includeImages = true, onProgress } = {}) => {
    await flush()
    await kvSet('settings', settingsRef.current)
    const out = await buildBackup({ includeImages, onProgress })
    downloadBlob(out.blob, backupFilename())
    const nextMeta = { ...meta, lastBackupAt: new Date().toISOString() }
    setMeta(nextMeta)
    await kvSet('meta', nextMeta)
    return out
  }, [flush, meta])

  const inspectBackup = useCallback((file) => readBackup(file), [])

  const restore = useCallback(async (file, parsed, { onProgress } = {}) => {
    await flush()
    const result = await restoreBackup(file, parsed, { settings: settingsRef.current, workspaces, onProgress })
    settingsRef.current = { ...DEFAULT_SETTINGS, ...result.settings }
    setSettings(settingsRef.current)
    setRuntimeSettings(settingsRef.current)
    setWorkspaces(result.workspaces)
    releaseAll()
    await openDoc(activeRef.current)
    return result
  }, [flush, openDoc, workspaces])

  const importV2 = useCallback(async () => {
    if (!hasV2Data()) {
      toast('No old v2 data in this browser.')
      return
    }
    const v2 = readV2()
    updateSettings(migrateSettings(v2, settingsRef.current))
    const { doc: next, summary } = await migrateDoc(v2, docRef.current)
    update(() => next)
    toast(migrationMessage(summary), { kind: 'success', duration: 9000 })
  }, [toast, update, updateSettings])

  const value = useMemo(() => ({
    ready, bootError, settings, workspaces, activeId, doc, savedAt, thumbs, missing, session, skipServer,
    route, toasts, isPrimary, meta, metaState,
    update, getDoc, flush, updateSettings, toast, dismissToast, go,
    addImageFiles, addProcessed, deleteImages,
    switchWorkspace, createWorkspace, renameWorkspace, deleteWorkspace,
    refreshSession, login, logout, useWithoutServer, refreshMeta, takeOver,
    backup, inspectBackup, restore, importV2,
  }), [
    ready, bootError, settings, workspaces, activeId, doc, savedAt, thumbs, missing, session, skipServer,
    route, toasts, isPrimary, meta, metaState,
    update, getDoc, flush, updateSettings, toast, dismissToast, go,
    addImageFiles, addProcessed, deleteImages,
    switchWorkspace, createWorkspace, renameWorkspace, deleteWorkspace,
    refreshSession, login, logout, useWithoutServer, refreshMeta, takeOver,
    backup, inspectBackup, restore, importV2,
  ])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
