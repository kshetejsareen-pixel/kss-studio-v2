// Passcode session shared by every server function.
// Files and folders starting with "_" inside api/ are not routed by Vercel,
// so this module is only reachable through imports.
import crypto from 'node:crypto'

const COOKIE = 'kss_session'
const MAX_AGE = 30 * 24 * 3600 // 30 days

export const serverConfigured = () => !!process.env.KSS_PASSCODE

const secret = () =>
  crypto.createHash('sha256')
    .update('kss-session:' + (process.env.KSS_SESSION_SECRET || process.env.KSS_PASSCODE || ''))
    .digest()

const sign = (exp) => crypto.createHmac('sha256', secret()).update(String(exp)).digest('base64url')

function hostOf(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
}

function isLocal(req) {
  const host = hostOf(req).replace(/:\d+$/, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

function readCookie(req, name) {
  const raw = String(req.headers.cookie || '')
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return ''
}

export function issueCookie(req, res) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE
  const value = `${exp}.${sign(exp)}`
  const parts = [`${COOKIE}=${value}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${MAX_AGE}`]
  if (!isLocal(req)) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function clearCookie(req, res) {
  const parts = [`${COOKIE}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0']
  if (!isLocal(req)) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function isAuthed(req) {
  if (!serverConfigured()) return false
  const value = readCookie(req, COOKIE)
  const dot = value.indexOf('.')
  if (dot < 1) return false
  const exp = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  if (!/^\d+$/.test(exp)) return false
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false
  const want = Buffer.from(sign(exp))
  const got = Buffer.from(sig)
  return want.length === got.length && crypto.timingSafeEqual(want, got)
}

export function checkPasscode(input) {
  const expected = String(process.env.KSS_PASSCODE || '')
  if (!expected) return false
  const a = crypto.createHash('sha256').update(String(input || '')).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

// Blocks cross-site form posts and fetches. Requests without an Origin header
// (same-origin GETs, curl) are allowed; the cookie is SameSite=Strict anyway.
export function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === hostOf(req) } catch { return false }
}

// Returns true when the request may proceed; otherwise it has already responded.
export function requireSession(req, res) {
  if (!serverConfigured()) {
    res.status(503).json({ error: 'Server is not configured (KSS_PASSCODE missing).', code: 'config' })
    return false
  }
  if (!sameOrigin(req)) {
    res.status(403).json({ error: 'Cross-origin request blocked.' })
    return false
  }
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'Not signed in.', code: 'session' })
    return false
  }
  return true
}
