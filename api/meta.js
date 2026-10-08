// Server-side Meta Graph proxy. The access token stays on the server and only
// the endpoints the studio actually uses are reachable.
import { requireSession } from './_lib/session.js'

const GRAPH = 'https://graph.facebook.com/v26.0'

const ROUTES = [
  [/^\/me$/, ['GET']],
  [/^\/me\/accounts$/, ['GET']],
  [/^\/me\/adaccounts$/, ['GET']],
  [/^\/debug_token$/, ['GET']],
  [/^\/search$/, ['GET']],
  [/^\/\d+$/, ['GET', 'DELETE']],
  [/^\/\d+\/media$/, ['GET', 'POST']],
  [/^\/\d+\/media_publish$/, ['POST']],
  [/^\/\d+\/insights$/, ['GET']],
  [/^\/\d+\/content_publishing_limit$/, ['GET']],
  [/^\/\d+\/comments$/, ['GET', 'POST']],
  [/^\/act_\d+$/, ['GET']],
  [/^\/act_\d+\/(campaigns|adsets|adcreatives|ads|customaudiences|adimages)$/, ['GET', 'POST']],
]

export function allowed(method, path) {
  return ROUTES.some(([re, methods]) => re.test(path) && methods.includes(method))
}

function encode(params) {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || k === 'access_token') continue
    out.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  return out
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!requireSession(req, res)) return
  const token = process.env.META_TOKEN
  if (!token) return res.status(503).json({ error: 'META_TOKEN is not set on the server.', code: 'config' })

  const { method = 'GET', path = '', params = {} } = req.body || {}
  const verb = String(method).toUpperCase()
  if (typeof path !== 'string' || !allowed(verb, path)) {
    return res.status(400).json({ error: { message: 'Endpoint not allowed.', code: 'not_allowed' } })
  }
  if (params && typeof params !== 'object') return res.status(400).json({ error: { message: 'Invalid params.' } })

  const query = encode(params)
  if (path === '/debug_token') query.set('input_token', token)

  let url = GRAPH + path
  const init = { method: verb, headers: { Authorization: `Bearer ${token}` } }
  if (verb === 'POST') {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    init.body = query.toString()
  } else if ([...query.keys()].length) {
    url += '?' + query.toString()
  }

  try {
    const r = await fetch(url, init)
    const text = await r.text()
    res.status(r.status)
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json')
    return res.send(text)
  } catch {
    return res.status(502).json({ error: { message: 'Could not reach Meta. Try again.' } })
  }
}
