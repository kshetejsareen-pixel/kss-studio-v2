// Google Drive import: list the images in a shared folder with an API key, download each
// one, and run it through the normal import pipeline. Works with "Anyone with the link"
// folders; private folders would need OAuth, which the studio does not ask for.
import { mapLimit } from './pool.js'
import { decodeUrl, makeCanvas, canvasToBlob } from './image.js'
import { processFile } from '../data/media.js'

const API = 'https://www.googleapis.com/drive/v3/files'

export function extractFolderId(input) {
  const s = String(input || '').trim()
  for (const re of [/\/folders\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/, /\/d\/([a-zA-Z0-9_-]+)/]) {
    const m = re.exec(s)
    if (m) return m[1]
  }
  return /^[a-zA-Z0-9_-]{10,}$/.test(s) ? s : null
}

function driveError(status, data) {
  if (status === 403) return new Error('API key not authorised for Drive API — enable the Drive API for this key in Google Cloud.')
  if (status === 404) return new Error('Folder not found — check URL and sharing settings')
  return new Error(data?.error?.message || `Google Drive error (${status}).`)
}

export async function listFolderImages(folderId, key, { signal } = {}) {
  const files = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
      pageSize: '1000',
      fields: 'nextPageToken,files(id,name,mimeType,size,imageMediaMetadata(width,height))',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      key,
    })
    if (pageToken) params.set('pageToken', pageToken)
    let res
    try {
      res = await fetch(`${API}?${params}`, { signal })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      throw new Error('Could not reach Google Drive — check your connection.')
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) throw driveError(res.status, data)
    files.push(...(data?.files || []))
    pageToken = data?.nextPageToken || ''
  } while (pageToken)
  return files
}

const isHeic = (f) => /heic|heif/i.test(f.mimeType || '') || /\.(heic|heif)$/i.test(f.name || '')

// Downloads one file. The API route keeps the bytes untouched; the thumbnail host is a
// fallback for keys that can list but not download.
export async function downloadDriveFile(file, key, { signal } = {}) {
  if (isHeic(file)) throw new Error(`${file.name}: HEIC files can't be read in the browser — convert to JPEG first.`)
  try {
    const res = await fetch(`${API}/${file.id}?alt=media&key=${encodeURIComponent(key)}&supportsAllDrives=true`, { signal })
    if (res.ok) return await res.blob()
  } catch (err) {
    if (err?.name === 'AbortError') throw err
  }
  let decoded
  try {
    decoded = await decodeUrl(`https://lh3.googleusercontent.com/d/${file.id}=w2400`)
  } catch {
    throw new Error(`${file.name}: Google blocked the download — check the folder is shared as "Anyone with the link".`)
  }
  const canvas = makeCanvas(decoded.width, decoded.height)
  canvas.getContext('2d').drawImage(decoded.source, 0, 0)
  decoded.close?.()
  try {
    return await canvasToBlob(canvas, 'image/jpeg', 0.92)
  } catch {
    throw new Error(`${file.name}: Google blocked the download — check the folder is shared as "Anyone with the link".`)
  }
}

// Imports every folder. `existing` is the set of driveIds already in the library.
// Returns { entries, skipped, errors } — entries are processFile() results to store.
export async function importDriveFolders(folderIds, key, { existing = new Set(), onStatus, signal } = {}) {
  if (!key) throw new Error('Add Google API key in Settings first')
  if (!folderIds.length) throw new Error('Add at least one folder first')
  onStatus?.('Scanning folder…')
  const all = []
  for (const id of folderIds) all.push(...(await listFolderImages(id, key, { signal })))
  const seen = new Set()
  const files = all.filter((f) => {
    if (existing.has(f.id) || seen.has(f.id)) return false
    seen.add(f.id)
    return true
  })
  const skipped = all.length - files.length
  if (!files.length) return { entries: [], skipped, errors: [], total: all.length }
  onStatus?.(`Found ${files.length} images — loading…`)
  let done = 0
  const settled = await mapLimit(files, 3, async (f) => {
    const blob = await downloadDriveFile(f, key, { signal })
    const out = await processFile(blob, { name: f.name, source: 'drive', driveId: f.id })
    done += 1
    onStatus?.(`Loading ${done} of ${files.length}…`)
    return out
  }, { signal })
  const entries = []
  const errors = []
  settled.forEach((r, i) => (r.error ? errors.push(`${files[i].name}: ${r.error.message}`) : entries.push(r.value)))
  if (!entries.length && errors.length) throw new Error('No images could be loaded — check folder sharing settings')
  onStatus?.(`${entries.length} images loaded`)
  return { entries, skipped, errors, total: all.length }
}
