// Claude client.
// Server mode: requests go to /api/claude and the API key stays on Vercel.
// Browser-only mode: the Anthropic SDK is loaded on demand and calls the API directly
// with the key from Settings, or goes through the user's Cloudflare proxy.
import { runtime, emit } from './runtime.js'

export class ClaudeError extends Error {
  // kind: auth | rate | overloaded | refusal | network | config | parse | api
  constructor(message, { status = 0, kind = 'api' } = {}) {
    super(message)
    this.name = 'ClaudeError'
    this.status = status
    this.kind = kind
  }
}

export const DEFAULT_MODELS = { opus: 'claude-opus-5', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5' }

export const MODEL_OPTIONS = {
  opus: ['claude-opus-5', 'claude-opus-5-5'],
  sonnet: ['claude-sonnet-5'],
  haiku: ['claude-haiku-4-5'],
}

export function modelFor(tier) {
  const models = { ...DEFAULT_MODELS, ...(runtime.settings.models || {}) }
  return models[tier] || DEFAULT_MODELS.sonnet
}

// "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5-20251001" -> "Haiku 4.5"
export function modelLabel(id) {
  const parts = String(id || '').replace(/^claude-/, '').split('-').filter((p) => !/^\d{8}$/.test(p))
  if (!parts.length) return 'Claude'
  const [family, ...version] = parts
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join('.')}`.trim()
}

const isHaiku = (model) => model.startsWith('claude-haiku')
const MAX_LOOPS = 6
const MAX_BODY = 4_000_000

export function imageBlock(dataUrl) {
  const url = String(dataUrl || '')
  const comma = url.indexOf(',')
  const head = comma > 0 ? url.slice(0, comma) : ''
  const match = /^data:(image\/[a-z+.-]+);base64$/i.exec(head)
  if (!match) throw new ClaudeError('An image could not be prepared for Claude.', { kind: 'config' })
  return { type: 'image', source: { type: 'base64', media_type: match[1].toLowerCase(), data: url.slice(comma + 1) } }
}

// Images first, then the instruction: Claude reads the pictures before the question.
export function buildContent(prompt, images = []) {
  const content = images.filter(Boolean).map((img) => (typeof img === 'string' ? imageBlock(img) : img))
  if (prompt) content.push({ type: 'text', text: prompt })
  return content
}

// "Photo 1" label before each image so prompts can refer to images by number.
export function labelledImages(images, label = 'Photo') {
  const out = []
  images.forEach((img, i) => {
    if (!img) return
    out.push({ type: 'text', text: `${label} ${i + 1}` })
    out.push(typeof img === 'string' ? imageBlock(img) : img)
  })
  return out
}

export function buildRequest({
  tier = 'sonnet', model, system, messages, prompt, images, content,
  maxTokens = 2000, effort, thinking, search = 0, fetch: useFetch = false,
}) {
  const m = model || modelFor(tier)
  const haiku = isHaiku(m)
  const body = {
    model: m,
    max_tokens: haiku ? Math.max(64, Math.min(16000, maxTokens)) : Math.max(1024, Math.min(16000, maxTokens)),
    messages: messages || [{ role: 'user', content: content || buildContent(prompt, images) }],
  }
  if (system) body.system = system
  const tools = []
  if (search > 0) {
    tools.push({ type: haiku ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: search })
  }
  if (useFetch && !haiku) tools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 })
  if (tools.length) body.tools = tools

  if (!haiku) {
    if (effort) body.output_config = { effort }
    let mode = thinking
    if (mode === 'disabled' && m === 'claude-opus-5-5') {
      // Thinking is always on for this model; give it room to think and answer.
      mode = undefined
      body.max_tokens = Math.max(body.max_tokens, 4000)
    }
    if (mode === 'disabled' && m === 'claude-opus-5' && (effort === 'xhigh' || effort === 'max')) mode = undefined
    if (mode) body.thinking = { type: mode }
  }
  return body
}

export async function callClaude(opts) {
  const body = buildRequest(opts)
  if (JSON.stringify(body).length > MAX_BODY) {
    throw new ClaudeError('Request too large — use fewer or smaller images.', { kind: 'config' })
  }
  const result = runtime.session.claudeMode === 'server'
    ? await viaServer(body, opts.signal)
    : await viaLegacy(body, opts.signal)

  if (result.fallback?.to) emit('kss:fallback', result.fallback)
  if (result.stop_reason === 'refusal') {
    throw new ClaudeError(result.stop_details?.explanation || 'Claude declined this request.', { kind: 'refusal' })
  }
  return { ...result, truncated: result.stop_reason === 'max_tokens' }
}

function kindFor(status, code) {
  if (code === 'config') return 'config'
  if (code === 'session' || status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate'
  if (status === 529 || status === 503) return 'overloaded'
  return 'api'
}

async function viaServer(body, signal) {
  let res
  try {
    res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new ClaudeError('Could not reach the studio server. Check your connection.', { kind: 'network' })
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    if (res.status === 401 && data?.code === 'session') emit('kss:unauthed')
    let message = typeof data?.error === 'string' ? data.error : data?.error?.message
    if (!message && res.status === 504) message = 'Claude took too long to answer. Try again, or send fewer images.'
    if (!message && res.status === 413) message = 'Request too large — use fewer or smaller images.'
    throw new ClaudeError(message || `Claude request failed (${res.status}).`, { status: res.status, kind: kindFor(res.status, data?.code) })
  }
  if (!data || typeof data.text !== 'string') {
    throw new ClaudeError('The studio server sent an unexpected reply.', { status: res.status })
  }
  return data
}

// ---- Browser-only mode --------------------------------------------------------

const ERROR_STATUS = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
}

// The old proxy only allows a few request headers through CORS and answers errors with
// HTTP 200, so requests through a proxy drop the SDK's extra headers and errors get
// their real status back before the SDK reads them.
function legacyFetch(secret) {
  return async (url, init = {}) => {
    const headers = new Headers(init.headers || {})
    for (const name of [...headers.keys()]) {
      if (name.startsWith('x-stainless') || name === 'anthropic-dangerous-direct-browser-access' || name === 'user-agent') {
        headers.delete(name)
      }
    }
    if (secret) headers.set('x-kss-secret', secret)
    const res = await fetch(url, { ...init, headers })
    if (res.status !== 200) return res
    const text = await res.text()
    let status = 200
    try {
      const data = JSON.parse(text)
      if (data?.type === 'error') status = ERROR_STATUS[data.error?.type] || 500
    } catch {
      // Not JSON; the SDK reports it.
    }
    return new Response(text, { status, statusText: status === 200 ? res.statusText : 'Error', headers: res.headers })
  }
}

let legacy = { key: '', client: null }

async function legacyClient() {
  const s = runtime.settings
  const apiKey = String(s.anthropicKey || '').trim()
  const proxy = String(s.proxyUrl || '').trim().replace(/\/+$/, '')
  const secret = String(s.proxySecret || '').trim()
  if (!apiKey && !proxy) throw new ClaudeError('Add a Claude API key or proxy in Settings.', { kind: 'config' })
  const cacheKey = `${apiKey}|${proxy}|${secret}`
  if (legacy.client && legacy.key === cacheKey) return legacy.client
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({
    apiKey: apiKey || 'via-proxy',
    baseURL: proxy || undefined,
    dangerouslyAllowBrowser: true,
    fetch: proxy ? legacyFetch(secret) : undefined,
    maxRetries: 1,
    timeout: 280000,
  })
  legacy = { key: cacheKey, client }
  return client
}

function toClaudeError(err, signal) {
  if (signal?.aborted) return new DOMException('Request cancelled.', 'AbortError')
  if (err instanceof ClaudeError) return err
  const status = Number(err?.status) || 0
  if (!status) {
    if (/timed out/i.test(String(err?.message))) {
      return new ClaudeError('Claude took too long to answer. Try again, or send fewer images.', { kind: 'network' })
    }
    return new ClaudeError('Could not reach Claude. Check the proxy URL or your connection.', { kind: 'network' })
  }
  const detail = String(err?.error?.error?.message || err?.message || 'Claude request failed.').slice(0, 300)
  const kind = kindFor(status)
  const message = kind === 'auth' ? `Claude rejected the key or proxy secret (${detail}). Check Settings.` : detail
  return new ClaudeError(message, { status, kind })
}

async function viaLegacy(body, signal) {
  const client = await legacyClient()
  const messages = [...body.messages]
  const content = []
  let last
  try {
    for (let i = 0; i < MAX_LOOPS; i++) {
      last = await client.messages.create({ ...body, messages }, { signal })
      content.push(...last.content)
      if (last.stop_reason !== 'pause_turn') break
      messages.push({ role: 'assistant', content: echoable(last.content) })
    }
  } catch (err) {
    throw toClaudeError(err, signal)
  }
  return summarize(content, last)
}

// Same rules as api/claude.js: after a mid-output fallback, blocks before the last
// fallback marker that the next model cannot validate are not echoed back.
function echoable(content) {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback')
  if (lastFallback < 0) return content
  const resultIds = new Set(content.filter((b) => b.type?.endsWith('_tool_result')).map((b) => b.tool_use_id))
  return content.filter((b, i) => {
    if (i >= lastFallback) return true
    if (b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use') return false
    if (b.type === 'server_tool_use') return resultIds.has(b.id)
    return true
  })
}

function summarize(content, last) {
  const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  const seen = new Set()
  const citations = []
  for (const b of content) {
    if (b.type !== 'text' || !Array.isArray(b.citations)) continue
    for (const c of b.citations) {
      if (c.type !== 'web_search_result_location' || !c.url || seen.has(c.url)) continue
      seen.add(c.url)
      citations.push({ url: c.url, title: c.title || c.url, cited_text: c.cited_text || '' })
    }
  }
  const fb = content.filter((b) => b.type === 'fallback').pop()
  return {
    text,
    citations,
    stop_reason: last?.stop_reason,
    stop_details: last?.stop_details || null,
    model: last?.model,
    usage: last?.usage,
    fallback: fb
      ? { from: typeof fb.from === 'string' ? fb.from : fb.from?.model, to: typeof fb.to === 'string' ? fb.to : fb.to?.model }
      : null,
  }
}

// ---- JSON answers -------------------------------------------------------------

export function parseJson(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new ClaudeError('Claude did not return JSON.', { kind: 'parse' })
  const attempts = [raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()]
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  if (fenced) attempts.push(fenced[1].trim())
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next shape
    }
  }
  const body = attempts[0]
  const start = body.search(/[[{]/)
  if (start < 0) throw new ClaudeError('Claude did not return JSON.', { kind: 'parse' })
  const end = body.lastIndexOf(body[start] === '[' ? ']' : '}')
  if (end > start) {
    try {
      return JSON.parse(body.slice(start, end + 1))
    } catch {
      // fall through
    }
  }
  throw new ClaudeError('Claude returned JSON that could not be read. Try again.', { kind: 'parse' })
}

export async function askJson(opts) {
  const res = await callClaude(opts)
  try {
    return parseJson(res.text)
  } catch (err) {
    if (res.truncated) {
      throw new ClaudeError('Claude ran out of room before finishing. Try again with fewer images or a shorter request.', { kind: 'parse' })
    }
    throw err
  }
}

export async function askText(opts) {
  const res = await callClaude(opts)
  return res.text.trim()
}

export function errorMessage(err) {
  if (!err) return 'Something went wrong.'
  if (err.name === 'AbortError') return 'Cancelled.'
  return err.message || String(err)
}

export const isAbort = (err) => err?.name === 'AbortError'
