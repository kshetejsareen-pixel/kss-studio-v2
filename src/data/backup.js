// Backup files (.kssb): one file holding settings, every workspace and, optionally, the
// image files. Layout:
//   KSSB1\n<manifest JSON on one line>\n<full blob, thumb blob, full blob, thumb blob, ...>
// The manifest lists each image's byte sizes so a restore can slice the blobs back out
// without reading the whole file into memory. API keys and tokens are never included.
import { kvGet, kvSet, blobGet, blobPutMany } from './db.js'
import { SECRET_KEYS, normalizeDoc } from './model.js'

const MAGIC = 'KSSB1'
const NEWLINE = 0x0a

function publicSettings(settings) {
  const out = { ...(settings || {}) }
  for (const k of SECRET_KEYS) delete out[k]
  return out
}

export function backupFilename(date = new Date()) {
  return `KSS-Studio-backup-${date.toISOString().slice(0, 10)}.kssb`
}

// Builds the backup as a Blob from what is saved in IndexedDB. Flush pending saves first.
export async function buildBackup({ includeImages = true, onProgress } = {}) {
  const settings = (await kvGet('settings')) || {}
  const list = (await kvGet('workspaces')) || []
  const workspaces = []
  const imageIds = new Set()
  for (const meta of list) {
    const doc = await kvGet(`ws:${meta.id}`)
    if (!doc) continue
    workspaces.push({ meta, doc })
    for (const img of doc.images || []) imageIds.add(img.id)
  }

  const blobs = []
  const parts = []
  if (includeImages) {
    const ids = [...imageIds]
    for (let i = 0; i < ids.length; i++) {
      const rec = await blobGet(ids[i]).catch(() => null)
      if (rec?.full || rec?.thumb) {
        const full = rec.full || rec.thumb
        const thumb = rec.thumb || rec.full
        blobs.push({ id: ids[i], fullSize: full.size, fullType: full.type || 'image/jpeg', thumbSize: thumb.size, thumbType: thumb.type || 'image/jpeg' })
        parts.push(full, thumb)
      }
      if (i % 20 === 19) onProgress?.(i + 1, ids.length)
    }
    onProgress?.(ids.length, ids.length)
  }

  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: publicSettings(settings),
    workspaces,
    blobs,
  }
  const blob = new Blob([`${MAGIC}\n`, JSON.stringify(manifest), '\n', ...parts], { type: 'application/octet-stream' })
  return { blob, workspaces: workspaces.length, images: blobs.length }
}

// Reads the manifest from the start of a backup file.
export async function readBackup(file) {
  let size = 64 * 1024
  for (;;) {
    const end = Math.min(size, file.size)
    const bytes = new Uint8Array(await file.slice(0, end).arrayBuffer())
    const first = bytes.indexOf(NEWLINE)
    if (first < 0 && end >= file.size) throw new Error('This is not a KSS Studio backup file.')
    if (first >= 0) {
      const magic = new TextDecoder().decode(bytes.subarray(0, first))
      if (magic !== MAGIC) throw new Error('This is not a KSS Studio backup file.')
      const second = bytes.indexOf(NEWLINE, first + 1)
      if (second >= 0) {
        let manifest
        try {
          manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(first + 1, second)))
        } catch {
          throw new Error('Backup file is incomplete.')
        }
        if (!manifest || !Array.isArray(manifest.workspaces)) throw new Error('Backup file is incomplete.')
        manifest.blobs = Array.isArray(manifest.blobs) ? manifest.blobs : []
        const offset = second + 1
        const needed = manifest.blobs.reduce((n, b) => n + (b.fullSize || 0) + (b.thumbSize || 0), 0)
        if (offset + needed > file.size) throw new Error('Backup file is incomplete.')
        return { manifest, offset }
      }
    }
    if (end >= file.size) throw new Error('Backup file is incomplete.')
    size *= 4
  }
}

// Writes the backup into IndexedDB. Workspaces with the same id are replaced (the caller
// asks first); settings are merged without touching keys or tokens.
export async function restoreBackup(file, { manifest, offset }, { settings, workspaces, onProgress }) {
  let pos = offset
  const total = manifest.blobs.length
  for (let i = 0; i < total; i += 20) {
    const batch = []
    for (const b of manifest.blobs.slice(i, i + 20)) {
      const full = file.slice(pos, pos + b.fullSize, b.fullType || 'image/jpeg')
      pos += b.fullSize
      const thumb = file.slice(pos, pos + b.thumbSize, b.thumbType || 'image/jpeg')
      pos += b.thumbSize
      // Copy out of the File so the stored Blob does not depend on it.
      const [fullBuf, thumbBuf] = await Promise.all([full.arrayBuffer(), thumb.arrayBuffer()])
      batch.push([b.id, { full: new Blob([fullBuf], { type: full.type }), thumb: new Blob([thumbBuf], { type: thumb.type }) }])
    }
    await blobPutMany(batch)
    onProgress?.(Math.min(i + 20, total), total)
  }

  const list = [...(workspaces || [])]
  for (const { meta, doc } of manifest.workspaces) {
    if (!meta?.id) continue
    await kvSet(`ws:${meta.id}`, normalizeDoc(doc))
    const entry = { id: meta.id, name: meta.name || 'Restored', createdAt: meta.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() }
    const at = list.findIndex((w) => w.id === meta.id)
    if (at >= 0) list[at] = entry
    else list.push(entry)
  }
  await kvSet('workspaces', list)

  const merged = { ...(settings || {}), ...publicSettings(manifest.settings) }
  for (const k of SECRET_KEYS) merged[k] = settings?.[k] || ''
  await kvSet('settings', merged)
  return { workspaces: list, settings: merged, restoredWorkspaces: manifest.workspaces.length, images: total }
}
