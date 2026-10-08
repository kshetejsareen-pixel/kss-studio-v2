// Renders a generated design (HTML) to an image with headless Chrome.
// The HTML comes from Claude, so it is treated as untrusted: scripts are disabled,
// handlers are stripped and the page may only load fonts, Cloudinary images and data URLs.
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { serverConfigured, requireSession } from './_lib/session.js'
import { DESIGN_FONTS_URL } from './_lib/fonts.js'

const MAX_HTML = 4_200_000
const MAX_RESPONSE = 4_300_000 // Vercel caps function responses at 4.5 MB
const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'res.cloudinary.com'])

export function sanitize(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<(iframe|frame|frameset|object|embed|portal)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(iframe|frame|frameset|object|embed|portal|base|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"')
}

function allowedRequest(url) {
  if (url.startsWith('data:') || url.startsWith('about:')) return true
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

const clamp = (v, lo, hi, d) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

async function launch(width, height) {
  const local = process.env.CHROME_PATH
  return puppeteer.launch({
    args: local ? ['--no-sandbox', '--disable-gpu'] : chromium.args,
    defaultViewport: { width, height },
    executablePath: local || (await chromium.executablePath()),
    headless: local ? true : chromium.headless,
  })
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (serverConfigured() && !requireSession(req, res)) return

  const { html, width, height, format } = req.body || {}
  if (typeof html !== 'string' || !html.trim()) return res.status(400).json({ error: 'No HTML provided.' })
  if (html.length > MAX_HTML) return res.status(413).json({ error: 'Design is too large to export.' })
  const w = clamp(width, 200, 2160, 1080)
  const h = clamp(height, 200, 2160 * 2, 1350)
  const scale = Math.min(2, 2160 / w)
  let type = format === 'png' ? 'png' : 'jpeg'

  let browser
  try {
    browser = await launch(w, h)
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (r) => (allowedRequest(r.url()) ? r.continue() : r.abort()))
    await page.setViewport({ width: w, height: h, deviceScaleFactor: scale })

    const doc = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<link rel="stylesheet" href="${DESIGN_FONTS_URL}"/>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${w}px;height:${h}px;overflow:hidden;background:#000}</style>
</head><body>${sanitize(html)}</body></html>`
    try {
      await page.setContent(doc, { waitUntil: 'networkidle0', timeout: 15000 })
    } catch {
      // A slow font or image should not block the export; render what has loaded.
    }
    try {
      await page.evaluate(() => document.fonts.ready.then(() => true))
    } catch {
      await new Promise((r) => setTimeout(r, 800))
    }
    await new Promise((r) => setTimeout(r, 300))

    const shot = async (t) => page.screenshot({
      type: t,
      clip: { x: 0, y: 0, width: w, height: h },
      ...(t === 'jpeg' ? { quality: 92 } : {}),
    })
    let image = await shot(type)
    if (image.length > MAX_RESPONSE && type === 'png') {
      type = 'jpeg'
      image = await shot('jpeg')
    }
    if (image.length > MAX_RESPONSE) return res.status(413).json({ error: 'Rendered image is too large.' })

    res.setHeader('Content-Type', type === 'png' ? 'image/png' : 'image/jpeg')
    res.setHeader('X-KSS-Format', type)
    return res.send(Buffer.from(image))
  } catch (err) {
    console.error('export-png failed:', err)
    return res.status(500).json({ error: 'Export failed. Try again.' })
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}
