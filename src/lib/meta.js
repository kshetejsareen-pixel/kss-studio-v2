// Meta Graph API client. With the server configured, calls go through /api/meta and the
// token never reaches the browser. Without it, the token saved in this browser is sent
// as an Authorization header (never in the URL).
import { runtime, emit } from './runtime.js'

export const GRAPH = 'https://graph.facebook.com/v26.0'

export const REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
  'instagram_manage_comments',
  'pages_show_list',
  'pages_read_engagement',
  'ads_management',
  'ads_read',
]

export class MetaError extends Error {
  constructor(message, { code = 0, subcode = 0, kind = 'api', status = 0, title = '' } = {}) {
    super(message)
    this.name = 'MetaError'
    this.code = code
    this.subcode = subcode
    this.kind = kind
    this.status = status
    this.title = title
  }
}

const RATE_CODES = new Set([4, 17, 32, 613])

function kindOf(code, status) {
  if (code === 190 || code === 102) return 'auth'
  if (RATE_CODES.has(code) || status === 429) return 'rate'
  if (code === 10 || (code >= 200 && code < 300)) return 'permission'
  if (code === 100) return 'param'
  return 'api'
}

export function metaError(status, data) {
  const e = data?.error
  // Errors from our own server function: { error: 'text', code? }
  if (typeof e === 'string') {
    if (data.code === 'session') emit('kss:unauthed')
    const kind = data.code === 'session' ? 'session' : data.code === 'config' ? 'config' : 'api'
    return new MetaError(e, { status, kind })
  }
  if (e && typeof e === 'object') {
    if (e.code === 'not_allowed') return new MetaError(e.message || 'Endpoint not allowed.', { status, kind: 'config' })
    const code = Number(e.code) || 0
    const subcode = Number(e.error_subcode) || 0
    const kind = kindOf(code, status)
    const detail = e.error_user_msg || e.message || 'Meta returned an error.'
    let message = detail
    if (kind === 'auth') message = `Meta token expired or invalid — reconnect in Settings. (${detail})`
    else if (kind === 'rate') message = `Meta rate limit reached — wait a few minutes and try again. (${detail})`
    else if (kind === 'permission') message = `Meta permission missing — check the token's permissions in Settings. (${detail})`
    return new MetaError(message, { code, subcode, kind, status, title: e.error_user_title || '' })
  }
  return new MetaError(`Meta request failed (${status || 'no response'}).`, { status })
}

function encode(params) {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === undefined || k === 'access_token') continue
    out.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  return out
}

async function readJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return null
  }
}

export async function graph(method, path, params = {}, { signal } = {}) {
  const verb = String(method || 'GET').toUpperCase()
  let res
  try {
    if (runtime.session.metaMode === 'server') {
      res = await fetch('/api/meta', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: verb, path, params }),
        signal,
      })
    } else {
      const token = String(runtime.settings.metaToken || '').trim()
      if (!token) throw new MetaError('Add a Meta access token in Settings.', { kind: 'config' })
      const query = encode(params)
      let url = GRAPH + path
      const init = { method: verb, headers: { Authorization: `Bearer ${token}` }, signal }
      if (verb === 'POST') {
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded'
        init.body = query.toString()
      } else if ([...query.keys()].length) {
        url += `?${query.toString()}`
      }
      res = await fetch(url, init)
    }
  } catch (err) {
    if (err instanceof MetaError || err?.name === 'AbortError') throw err
    throw new MetaError('Could not reach Meta — check your connection.', { kind: 'network' })
  }
  const data = await readJson(res)
  if (!res.ok || data?.error || data === null) throw metaError(res.status, data)
  return data
}

// Follows cursor paging until there is no next page or `limit` items are collected.
export async function graphAll(path, params = {}, { limit = 500, signal } = {}) {
  const items = []
  let after = null
  for (let guard = 0; guard < 50; guard++) {
    const data = await graph('GET', path, after ? { ...params, after } : params, { signal })
    items.push(...(data.data || []))
    after = data.paging?.cursors?.after
    if (!data.paging?.next || !after || items.length >= limit) break
  }
  return items.slice(0, limit)
}

// Token status for the connection badge: { ok, name, expiresAt, scopes, missing, error }.
// expiresAt is ms since epoch, 0 for a token that never expires, null when unknown.
export async function metaStatus() {
  try {
    if (runtime.session.metaMode === 'server') {
      const [debug, me] = await Promise.all([
        graph('GET', '/debug_token'),
        graph('GET', '/me', { fields: 'id,name' }).catch(() => null),
      ])
      const d = debug.data || {}
      const scopes = Array.isArray(d.scopes) ? d.scopes : []
      return {
        ok: !!d.is_valid,
        name: me?.name || '',
        expiresAt: d.expires_at ? d.expires_at * 1000 : 0,
        scopes,
        missing: REQUIRED_SCOPES.filter((s) => !scopes.includes(s)),
        error: d.is_valid ? null : d.error?.message || 'Token is not valid.',
      }
    }
    const me = await graph('GET', '/me', { fields: 'id,name' })
    return { ok: true, name: me.name || '', expiresAt: null, scopes: null, missing: [], error: null }
  } catch (err) {
    return { ok: false, name: '', expiresAt: null, scopes: null, missing: [], error: err.message, kind: err.kind }
  }
}

// Pages with their linked Instagram accounts, plus ad accounts, for Settings.
export async function findAccounts() {
  const [pages, ads] = await Promise.all([
    graphAll('/me/accounts', { fields: 'name,id,instagram_business_account{id,username}', limit: 100 }),
    graphAll('/me/adaccounts', { fields: 'name,account_id,account_status,currency', limit: 100 }).catch(() => []),
  ])
  return {
    pages: pages.map((p) => ({ id: p.id, name: p.name, ig: p.instagram_business_account || null })),
    adAccounts: ads.map((a) => ({ id: `act_${a.account_id}`, accountId: a.account_id, name: a.name || a.account_id, currency: a.currency, status: a.account_status })),
  }
}

export const metaConfigured = (settings) =>
  (runtime.session.metaMode === 'server' || !!settings.metaToken) && !!settings.igAccountId
