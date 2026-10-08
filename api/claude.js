// Server-side Claude proxy. The API key never leaves the server.
// The browser sends a validated subset of the Messages API; anything unexpected is dropped.
import Anthropic from '@anthropic-ai/sdk'
import { requireSession } from './_lib/session.js'

const MODELS = new Set([
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-sonnet-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
])
const TOOL_TYPES = new Set(['web_search_20260209', 'web_search_20250305', 'web_fetch_20260209', 'web_fetch_20250910'])
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const MAX_LOOPS = 6

const isHaiku = (m) => m.startsWith('claude-haiku')
const isOpus5Family = (m) => /^claude-opus-5/.test(m)
const noFallback = new Set() // models whose fallback request was rejected; retried plainly from then on

let client
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 290000, maxRetries: 2 })
  return client
}

class BadRequest extends Error {}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

function cleanText(block) {
  if (typeof block.text !== 'string') throw new BadRequest('Text block without text.')
  return { type: 'text', text: block.text }
}

function cleanBlock(block) {
  if (!block || typeof block !== 'object') throw new BadRequest('Invalid content block.')
  if (block.type === 'text') return cleanText(block)
  if (block.type === 'image') {
    const src = block.source || {}
    if (src.type !== 'base64' || !IMAGE_TYPES.has(src.media_type) || typeof src.data !== 'string') {
      throw new BadRequest('Images must be base64 JPEG, PNG, WebP or GIF.')
    }
    return { type: 'image', source: { type: 'base64', media_type: src.media_type, data: src.data } }
  }
  throw new BadRequest(`Unsupported content block: ${String(block.type).slice(0, 40)}`)
}

// Assistant turns sent back by the browser (multi-turn refine) may only carry text.
function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw new BadRequest('messages is required.')
  if (messages.length > 40) throw new BadRequest('Too many messages.')
  return messages.map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new BadRequest('Invalid message role.')
    if (typeof m.content === 'string') return { role: m.role, content: m.content }
    if (!Array.isArray(m.content) || m.content.length === 0) throw new BadRequest('Invalid message content.')
    const content = m.content.map((b) => (m.role === 'assistant' ? cleanText(b) : cleanBlock(b)))
    return { role: m.role, content }
  })
}

function cleanSystem(system) {
  if (system == null || system === '') return undefined
  if (typeof system === 'string') return system
  if (Array.isArray(system)) return system.map(cleanText)
  throw new BadRequest('Invalid system prompt.')
}

function cleanTools(tools) {
  if (tools == null) return undefined
  if (!Array.isArray(tools) || tools.length > 4) throw new BadRequest('Invalid tools.')
  const out = tools.map((t) => {
    if (!t || !TOOL_TYPES.has(t.type)) throw new BadRequest('Only web search and web fetch tools are allowed.')
    const name = t.type.startsWith('web_search') ? 'web_search' : 'web_fetch'
    return { type: t.type, name, max_uses: clampInt(t.max_uses, 1, 10, 3) }
  })
  return out.length ? out : undefined
}

export function buildBody(input) {
  const model = String(input.model || '')
  if (!MODELS.has(model)) throw new BadRequest('Model not allowed.')
  const haiku = isHaiku(model)
  const body = {
    model,
    max_tokens: clampInt(input.max_tokens, haiku ? 64 : 1024, 16000, 4000),
    messages: cleanMessages(input.messages),
  }
  const system = cleanSystem(input.system)
  if (system) body.system = system
  const tools = cleanTools(input.tools)
  if (tools) {
    if (haiku && tools.some((t) => t.type !== 'web_search_20250305')) throw new BadRequest('Haiku only supports basic web search.')
    body.tools = tools
  }
  if (!haiku) {
    const effort = input.output_config?.effort ?? input.effort
    if (effort != null) {
      if (!EFFORTS.has(effort)) throw new BadRequest('Invalid effort.')
      body.output_config = { effort }
    }
    const thinking = input.thinking?.type
    if (thinking === 'disabled') {
      if (model === 'claude-opus-5-5') throw new BadRequest('Thinking cannot be disabled on this model.')
      if (model === 'claude-opus-5' && /^(xhigh|max)$/.test(body.output_config?.effort || '')) {
        throw new BadRequest('Thinking can only be disabled at effort high or below.')
      }
      body.thinking = { type: 'disabled' }
    } else if (thinking === 'adaptive') {
      body.thinking = { type: 'adaptive' }
    } else if (thinking != null) {
      throw new BadRequest('Invalid thinking setting.')
    }
  }
  return body
}

// After a mid-output fallback, blocks before the last fallback marker that the
// next model cannot validate must not be echoed back on a pause_turn continuation.
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

export function summarize(content, last) {
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
  const to = fb ? (typeof fb.to === 'string' ? fb.to : fb.to?.model) : null
  return {
    text,
    citations,
    stop_reason: last.stop_reason,
    stop_details: last.stop_details || null,
    model: last.model,
    usage: last.usage,
    fallback: fb ? { from: typeof fb.from === 'string' ? fb.from : fb.from?.model, to } : null,
  }
}

async function send(body) {
  const anthropic = getClient()
  if (isOpus5Family(body.model) && !noFallback.has(body.model)) {
    try {
      return await anthropic.beta.messages
        .stream({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        .finalMessage()
    } catch (err) {
      if (err?.status === 400 && /fallback/i.test(String(err?.message))) {
        noFallback.add(body.model)
      } else {
        throw err
      }
    }
  }
  return anthropic.messages.stream(body).finalMessage()
}

export async function run(body) {
  const messages = [...body.messages]
  const content = []
  let last
  for (let i = 0; i < MAX_LOOPS; i++) {
    last = await send({ ...body, messages })
    content.push(...last.content)
    if (last.stop_reason !== 'pause_turn') break
    messages.push({ role: 'assistant', content: echoable(last.content) })
  }
  return summarize(content, last)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!requireSession(req, res)) return
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not set on the server.', code: 'config' })
  }

  let body
  try {
    body = buildBody(req.body || {})
  } catch (err) {
    if (err instanceof BadRequest) return res.status(400).json({ error: err.message })
    throw err
  }

  try {
    return res.status(200).json(await run(body))
  } catch (err) {
    const status = Number(err?.status) || 502
    const message = String(err?.error?.error?.message || err?.message || 'Claude request failed.').slice(0, 300)
    return res.status(status >= 400 && status < 600 ? status : 502).json({ error: message })
  }
}
