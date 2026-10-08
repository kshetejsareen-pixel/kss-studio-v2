// Image files: the import pipeline, and the in-memory caches that turn stored Blobs into
// URLs for the screens. Each image is stored twice: `full` (up to 2160px, for publishing,
// design and Claude) and `thumb` (up to 480px, for grids).
import { blobGet, blobPutMany, blobDel } from './db.js'
import { decodeImage, resizeToBlob, analysePixels, phash, blobToDataUrl, dataUrlToBlob } from '../lib/image.js'
import { newImage, orientationOf } from './model.js'

export const FULL_MAX = 2160
const FULL_QUALITY = 0.9
const THUMB_MAX = 480
const THUMB_QUALITY = 0.8

// Decodes, resizes and measures one file. Nothing is stored until storeImages().
export async function processFile(file, extra = {}) {
  const name = extra.name || file.name || 'image.jpg'
  const decoded = await decodeImage(file, name)
  try {
    const full = await resizeToBlob(decoded, FULL_MAX, FULL_QUALITY)
    const thumb = await resizeToBlob(decoded, THUMB_MAX, THUMB_QUALITY)
    const stats = analysePixels(decoded)
    const image = newImage({
      name,
      width: decoded.width,
      height: decoded.height,
      orientation: orientationOf(decoded.width, decoded.height),
      mime: 'image/jpeg',
      bytes: full.blob.size,
      palette: stats.palette,
      brightness: stats.brightness,
      contrast: stats.contrast,
      warmth: stats.warmth,
      phash: phash(decoded),
      ...extra,
    })
    return { image, record: { full: full.blob, thumb: thumb.blob } }
  } finally {
    decoded.close()
  }
}

export function processDataUrl(dataUrl, extra = {}) {
  return processFile(dataUrlToBlob(dataUrl), extra)
}

// Saves processed images and makes their thumbnails available straight away.
export async function storeImages(entries) {
  if (!entries.length) return {}
  await blobPutMany(entries.map((e) => [e.image.id, e.record]))
  const urls = {}
  for (const e of entries) urls[e.image.id] = setThumb(e.image.id, e.record.thumb)
  return urls
}

// ---- Thumbnails ---------------------------------------------------------------------

const thumbUrls = new Map()

function setThumb(id, blob) {
  const old = thumbUrls.get(id)
  if (old) URL.revokeObjectURL(old)
  const url = URL.createObjectURL(blob)
  thumbUrls.set(id, url)
  return url
}

// Loads thumbnails in batches so a big library appears progressively.
export async function loadThumbs(ids, onBatch, batchSize = 24) {
  const missing = []
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize)
    const records = await Promise.all(slice.map((id) => blobGet(id).catch(() => null)))
    const part = {}
    slice.forEach((id, j) => {
      const rec = records[j]
      if (rec?.thumb) part[id] = thumbUrls.get(id) || setThumb(id, rec.thumb)
      else missing.push(id)
    })
    onBatch?.(part)
  }
  return missing
}

// ---- Full-size images -------------------------------------------------------------------

const FULL_LIMIT = 40
const fullUrls = new Map()
const fullPending = new Map()

export async function getFullBlob(id) {
  const rec = await blobGet(id)
  return rec?.full || rec?.thumb || null
}

// Object URL for the full image. The 40 most recent stay cached.
export function fullUrl(id) {
  if (fullUrls.has(id)) {
    const url = fullUrls.get(id)
    fullUrls.delete(id)
    fullUrls.set(id, url)
    return Promise.resolve(url)
  }
  if (fullPending.has(id)) return fullPending.get(id)
  const p = getFullBlob(id)
    .then((blob) => {
      if (!blob) return null
      const url = URL.createObjectURL(blob)
      fullUrls.set(id, url)
      while (fullUrls.size > FULL_LIMIT) {
        const [oldId, oldUrl] = fullUrls.entries().next().value
        fullUrls.delete(oldId)
        URL.revokeObjectURL(oldUrl)
      }
      return url
    })
    .finally(() => fullPending.delete(id))
  fullPending.set(id, p)
  return p
}

export const cachedFullUrl = (id) => fullUrls.get(id) || null

// ---- Data URLs for Claude and the renderer --------------------------------------------------

const VISION_LIMIT = 50
const visionCache = new Map()

async function encodedDataUrl(id, max, quality) {
  const blob = await getFullBlob(id)
  if (!blob) throw new Error('An image is missing from storage — re-import it in the Library.')
  const decoded = await decodeImage(blob)
  try {
    const { blob: out } = await resizeToBlob(decoded, max, quality)
    return blobToDataUrl(out)
  } finally {
    decoded.close()
  }
}

// JPEG data URL sized for Claude (1024px is plenty for analysis; 2576 is the vision cap).
export async function visionDataUrl(id, max = 1024) {
  const key = `${id}@${max}`
  if (visionCache.has(key)) {
    const v = visionCache.get(key)
    visionCache.delete(key)
    visionCache.set(key, v)
    return v
  }
  const url = await encodedDataUrl(id, max, 0.85)
  visionCache.set(key, url)
  while (visionCache.size > VISION_LIMIT) visionCache.delete(visionCache.keys().next().value)
  return url
}

// Image embedded into a design for the server renderer. Kept under ~3.2MB so the request
// stays inside Vercel's 4.5MB body limit.
export async function exportDataUrl(id) {
  let url = await encodedDataUrl(id, FULL_MAX, 0.88)
  if (url.length > 3_200_000 * 1.37) url = await encodedDataUrl(id, 1800, 0.85)
  return url
}

// ---- Clean-up ---------------------------------------------------------------------------------

function forget(id) {
  const t = thumbUrls.get(id)
  if (t) URL.revokeObjectURL(t)
  thumbUrls.delete(id)
  const f = fullUrls.get(id)
  if (f) URL.revokeObjectURL(f)
  fullUrls.delete(id)
  for (const key of [...visionCache.keys()]) if (key.startsWith(`${id}@`)) visionCache.delete(key)
}

export async function deleteImageData(ids) {
  ids.forEach(forget)
  await blobDel(ids)
}

// Called when switching workspace: the next workspace loads its own thumbnails.
export function releaseAll() {
  for (const url of thumbUrls.values()) URL.revokeObjectURL(url)
  for (const url of fullUrls.values()) URL.revokeObjectURL(url)
  thumbUrls.clear()
  fullUrls.clear()
  visionCache.clear()
}
