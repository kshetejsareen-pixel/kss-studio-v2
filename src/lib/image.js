// Decoding, resizing and measuring images in the browser. Nothing here touches storage.
import { cropRect } from '../data/model.js'

const HEIC_NAME = /\.(heic|heif)$/i

function loadImg(src, crossOrigin = false) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image could not be loaded.'))
    img.src = src
  })
}

// Decodes a Blob or File with its camera rotation applied.
// Returns { source, width, height, close } where `source` can be drawn to a canvas.
export async function decodeImage(blob, name = '') {
  const heic = /image\/hei[cf]/i.test(blob?.type || '') || HEIC_NAME.test(name || blob?.name || '')
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() }
    } catch {
      // Some browsers reject the options or the format here; <img> below tries again.
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImg(url)
    if (img.decode) await img.decode().catch(() => {})
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error(heic ? 'HEIC not supported — convert to JPEG first' : 'This file could not be read as an image.')
  }
}

// Loads a remote image for drawing. Drawing it fails later if the server does not allow CORS.
export async function decodeUrl(url) {
  const img = await loadImg(url, true)
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} }
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image could not be encoded.'))), type, quality)
    } catch (err) {
      reject(err)
    }
  })
}

export function fitWithin(w, h, max) {
  const s = Math.min(1, max / Math.max(w || 1, h || 1))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

// The whole image scaled down to `max` on its long edge (never up).
export async function resizeToBlob(decoded, max, quality = 0.9, type = 'image/jpeg') {
  const { width, height } = fitWithin(decoded.width, decoded.height, max)
  const c = makeCanvas(width, height)
  const ctx = c.getContext('2d')
  if (type === 'image/jpeg') {
    // JPEG has no transparency; without this, transparent areas turn black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(decoded.source, 0, 0, width, height)
  const blob = await canvasToBlob(c, type, quality)
  return { blob, width, height }
}

// A W x H JPEG of the image cover-fitted with the slide's focal point and zoom.
export async function cropToBlob(decoded, crop, W, H, quality = 0.92) {
  const c = makeCanvas(W, H)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, W, H)
  ctx.imageSmoothingQuality = 'high'
  const r = cropRect(decoded.width, decoded.height, W, H, crop)
  ctx.drawImage(decoded.source, r.dx, r.dy, r.dw, r.dh)
  return canvasToBlob(c, 'image/jpeg', quality)
}

function pixels(decoded, w, h) {
  const c = makeCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(decoded.source, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h).data
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
export const rgbHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase()

export function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Five dominant colours plus brightness (0-100), contrast (0-100) and warmth (-100 cool
// to 100 warm), from a 64 x 64 sample.
export function analysePixels(decoded) {
  const data = pixels(decoded, 64, 64)
  const bins = new Map()
  let n = 0
  let sum = 0
  let sumSq = 0
  let warm = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    n++
    sum += y
    sumSq += y * y
    warm += r - b
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    let bin = bins.get(key)
    if (!bin) bins.set(key, (bin = { count: 0, r: 0, g: 0, b: 0 }))
    bin.count++
    bin.r += r
    bin.g += g
    bin.b += b
  }
  if (!n) return { palette: [], brightness: 0, contrast: 0, warmth: 0 }
  const mean = sum / n
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
  const ranked = [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .map((bin) => [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count])
  // Skip colours too close to one already picked so the five read as distinct swatches.
  const picked = []
  for (const c of ranked) {
    if (picked.length >= 5) break
    if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 36)) picked.push(c)
  }
  for (const c of ranked) {
    if (picked.length >= 5) break
    if (!picked.includes(c)) picked.push(c)
  }
  return {
    palette: picked.map(([r, g, b]) => rgbHex(r, g, b)),
    brightness: Math.round(mean / 2.55),
    contrast: Math.round(Math.min(100, std / 1.275)),
    warmth: Math.round(warm / n / 2.55),
  }
}

const COS = (() => {
  const t = []
  for (let u = 0; u < 8; u++) {
    t[u] = new Float64Array(32)
    for (let x = 0; x < 32; x++) t[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / 64)
  }
  return t
})()

// Perceptual hash: the low frequencies of a 32 x 32 greyscale DCT as 16 hex characters.
// Near-identical photos (re-exports, small crops, edits) land within a few bits.
export function phash(decoded) {
  const data = pixels(decoded, 32, 32)
  const g = new Float64Array(1024)
  for (let i = 0; i < 1024; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  const coef = []
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0
      for (let y = 0; y < 32; y++) {
        const cy = COS[u][y]
        const row = y * 32
        for (let x = 0; x < 32; x++) s += g[row + x] * cy * COS[v][x]
      }
      coef.push(s)
    }
  }
  const ac = coef.slice(1).sort((a, b) => a - b)
  const median = ac[Math.floor(ac.length / 2)]
  let hex = ''
  for (let i = 0; i < 64; i += 4) {
    let nib = 0
    for (let j = 0; j < 4; j++) nib = (nib << 1) | (coef[i + j] > median ? 1 : 0)
    hex += nib.toString(16)
  }
  return hex
}

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)]
  return d
}

export const DUPLICATE_DISTANCE = 6

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error || new Error('Could not read the image.'))
    r.readAsDataURL(blob)
  })
}

export function dataUrlToBlob(dataUrl) {
  const s = String(dataUrl || '')
  const comma = s.indexOf(',')
  const head = s.slice(0, comma)
  const mime = /^data:([^;,]+)/.exec(head)?.[1] || 'application/octet-stream'
  const body = s.slice(comma + 1)
  if (!/;base64/i.test(head)) return new Blob([decodeURIComponent(body)], { type: mime })
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// Colour distance (0 identical, ~441 black vs white) between two hex colours.
export function colorDistance(a, b) {
  const x = hexRgb(a)
  const y = hexRgb(b)
  if (!x || !y) return 999
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

// Hue family of a hex colour, used for the colour filter.
export function colorFamily(hex) {
  const rgb = hexRgb(hex)
  if (!rgb) return 'neutral'
  const [r, g, b] = rgb.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (l < 0.12) return 'black'
  if (l > 0.9) return 'white'
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (s < 0.15) return 'neutral'
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  if (h < 20 || h >= 340) return 'red'
  if (h < 45) return l < 0.45 ? 'brown' : 'orange'
  if (h < 70) return 'yellow'
  if (h < 170) return 'green'
  if (h < 260) return 'blue'
  return 'purple'
}

export const COLOR_FAMILIES = ['black', 'white', 'neutral', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple']
