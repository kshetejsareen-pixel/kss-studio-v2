// Cloudflare Worker: a locked-down Claude proxy for KSS Studio's browser-only mode.
// Only needed if you do not use the Vercel server functions (api/claude.js).
//
// Differences from the old open proxy:
//   - only the studio's own origins may call it (no "*")
//   - only POST /v1/messages* is forwarded
//   - optional shared secret (x-kss-secret) so a leaked URL is useless
//   - the Anthropic key can live in the worker (ANTHROPIC_API_KEY) instead of the browser
//   - errors keep their real HTTP status
//   - server-side fallbacks are added for Opus 5 models (set FALLBACKS=off to disable)

const DEFAULT_ORIGINS = [
  'https://studio.kshetejsareen.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]
const VERCEL_PREVIEW = /^https:\/\/kss-studio[a-z0-9-]*\.vercel\.app$/
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

function originAllowed(origin, env) {
  if (!origin) return false
  const extra = String(env.EXTRA_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  return DEFAULT_ORIGINS.includes(origin) || extra.includes(origin) || VERCEL_PREVIEW.test(origin)
}

function corsHeaders(origin, request) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'content-type, x-api-key, anthropic-version, x-kss-secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const allowed = originAllowed(origin, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? corsHeaders(origin, request) : {} })
    }
    if (!allowed) return json(403, { type: 'error', error: { type: 'permission_error', message: 'Origin not allowed.' } })

    const cors = corsHeaders(origin, request)
    const url = new URL(request.url)
    if (request.method !== 'POST' || !url.pathname.startsWith('/v1/messages')) {
      return json(404, { type: 'error', error: { type: 'not_found_error', message: 'Not found.' } }, cors)
    }
    if (env.SHARED_SECRET && request.headers.get('x-kss-secret') !== env.SHARED_SECRET) {
      return json(401, { type: 'error', error: { type: 'authentication_error', message: 'Wrong proxy secret.' } }, cors)
    }

    const apiKey = env.ANTHROPIC_API_KEY || request.headers.get('x-api-key')
    if (!apiKey || apiKey === 'via-proxy') {
      return json(401, { type: 'error', error: { type: 'authentication_error', message: 'No API key on the proxy or in the request.' } }, cors)
    }

    let body = await request.text()
    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
    }
    if (env.FALLBACKS !== 'off' && url.pathname === '/v1/messages') {
      try {
        const parsed = JSON.parse(body)
        if (/^claude-opus-5/.test(parsed.model || '') && !parsed.fallbacks) {
          parsed.fallbacks = 'default'
          headers['anthropic-beta'] = FALLBACK_BETA
          body = JSON.stringify(parsed)
        }
      } catch {
        // Not JSON; forward unchanged and let the API answer.
      }
    }

    const upstream = await fetch('https://api.anthropic.com' + url.pathname, { method: 'POST', headers, body })
    const out = new Headers(cors)
    out.set('Content-Type', upstream.headers.get('content-type') || 'application/json')
    return new Response(upstream.body, { status: upstream.status, headers: out })
  },
}
