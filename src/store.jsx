// KSS Studio v2 — Global State
// Single source of truth. No Redux needed at this scale.

import { createContext, useContext, useReducer, useCallback } from 'react'

const PROXY = 'https://kss-proxy.kshetej-sareen.workers.dev'
const M_OPUS   = 'claude-opus-4-5'
const M_SONNET = 'claude-sonnet-4-5'
const M_HAIKU  = 'claude-haiku-4-5-20251001'

// Load saved settings from localStorage at startup
function loadSavedSettings() {
  try {
    const s = localStorage.getItem('kss_settings')
    return s ? JSON.parse(s) : {}
  } catch { return {} }
}

function loadSavedContext() {
  try { return localStorage.getItem('kss_global_context') || '' } catch { return '' }
}

const saved = loadSavedSettings()
const savedContext = loadSavedContext()

const initialState = {
  images: [],
  selected: [],
  plan: [],
  postW: 1080,
  postH: 1350,
  designSize: '4:5',
  queue: [],
  globalContext: savedContext,
  settings: {
    anthropicKey: saved.anthropicKey || '',
    googleKey: saved.googleKey || '',
    handle: saved.handle || '@kshetejsareenstudios',
    hashtags: saved.hashtags || '',
    cloudName: saved.cloudName || 'dsouvrzlr',
    cloudPreset: saved.cloudPreset || 'ml_default',
    metaToken: saved.metaToken || '',
    igAccountId: saved.igAccountId || '',
  },
  activeTab: 'plan',
  inspectIdx: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET': return { ...state, [action.key]: action.value }
    case 'MERGE': return { ...state, ...action.payload }
    case 'SET_SETTINGS': return { ...state, settings: { ...state.settings, ...action.payload } }
    case 'SET_PLAN_ITEM': {
      const plan = [...state.plan]
      plan[action.idx] = { ...plan[action.idx], ...action.payload }
      return { ...state, plan }
    }
    case 'RESET_PLAN': return { ...state, plan: action.plan, inspectIdx: null }
    default: return state
  }
}

const StoreContext = createContext(null)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const set = useCallback((key, value) => dispatch({ type: 'SET', key, value }), [])
  const merge = useCallback((payload) => dispatch({ type: 'MERGE', payload }), [])
  const setSettings = useCallback((payload) => dispatch({ type: 'SET_SETTINGS', payload }), [])
  const setPlanItem = useCallback((idx, payload) => dispatch({ type: 'SET_PLAN_ITEM', idx, payload }), [])
  const resetPlan = useCallback((plan) => dispatch({ type: 'RESET_PLAN', plan }), [])

  return (
    <StoreContext.Provider value={{ state, set, merge, setSettings, setPlanItem, resetPlan }}>
      {children}
    </StoreContext.Provider>
  )
}

export const useStore = () => useContext(StoreContext)

// ── API UTILITIES ──────────────────────────────────────────
export async function claudeCall(key, system, user, model = M_SONNET, maxTokens = 1500) {
  if (!key) throw new Error('No API key — add in Settings')
  const r = await fetch(PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e.error?.message || `HTTP ${r.status}`)
  }
  const d = await r.json()
  const text = d.content?.find(b => b.type === 'text')?.text
  if (!text) throw new Error('Empty response')
  return text
}

export async function claudeVision(key, system, userText, imageDataUrl, model = M_OPUS, maxTokens = 3000) {
  if (!key) throw new Error('No API key — add in Settings')
  const b64 = extractBase64(imageDataUrl)
  if (!b64) throw new Error('Invalid image')
  const resized = await resizeImage(imageDataUrl, 800)
  const b64r = extractBase64(resized)

  const r = await fetch(PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: b64r.mediaType, data: b64r.data } },
          { type: 'text', text: userText },
        ],
      }],
    }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e.error?.message || `HTTP ${r.status}`)
  }
  const d = await r.json()
  const text = d.content?.find(b => b.type === 'text')?.text
  if (!text) throw new Error('Empty response')
  return text
}

export async function claudeResearch(key, brandName) {
  if (!key) throw new Error('No API key')
  const system = `You are a brand researcher for a luxury photography studio. Return a 3-4 sentence profile covering: what the brand does, visual aesthetic, target audience, key people, location. Factual and specific.`
  // Try with web search first
  try {
    const r = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: M_SONNET,
        max_tokens: 600,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system,
        messages: [{ role: 'user', content: `Research "${brandName}" for Instagram content creation. Include positioning, visual style, founders, location.` }],
      }),
    })
    if (!r.ok) throw new Error('web search blocked')
    const d = await r.json()
    const text = d.content?.filter(b => b.type === 'text').map(b => b.text).join(' ')
    if (text) return text.trim().substring(0, 400)
  } catch { /* fall through to knowledge-only */ }

  // Fallback — knowledge only
  return await claudeCall(
    key,
    system,
    `Provide a brand profile for "${brandName}" for Instagram content creation. If you don't have specific knowledge, provide general context about this type of brand.`,
    M_SONNET, 400
  )
}

// ── IMAGE UTILITIES ──────────────────────────────────────
export function extractBase64(dataUrl) {
  const m = dataUrl?.match(/^data:([^;]+);base64,(.+)$/)
  return m ? { mediaType: m[1], data: m[2] } : null
}

export function resizeImage(dataUrl, maxPx = 800) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(maxPx / img.width, maxPx / img.height, 1)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export function getImageOrientation(w, h) {
  const ratio = w / h
  if (ratio > 1.1) return 'landscape'
  if (ratio < 0.9) return 'portrait'
  return 'square'
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = e => resolve(e.target.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export function getImageDimensions(dataUrl) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = dataUrl
  })
}

// ── CONSTANTS ──────────────────────────────────────────────
export { PROXY, M_OPUS, M_SONNET, M_HAIKU }
