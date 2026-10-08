// One-time import of the work v2 kept in localStorage. v2 never saved images, so plan
// items come across as idea posts with their captions, themes and notes. Nothing in
// localStorage is deleted here; Settings has a separate "Clear old v2 data" button.
import { uid } from '../lib/ids.js'
import { emptyKit, kitByName, newPost, MAX_KITS, DEFAULT_SETTINGS } from './model.js'
import { processDataUrl, storeImages } from './media.js'

const V2_KEYS = [
  'kss_settings',
  'kss_global_context',
  'kss_excluded_names',
  'kss_theme',
  'kss_caption_memory',
  'kss_session_autosave',
  'kss_drive_history',
  'kss_ref_links',
  'kss_plan_notes',
  'kss_ad_context',
  'kss_ad_audience',
  'kss_workspaces',
  'kss_active_workspace',
]

function get(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function json(key, fallback) {
  const raw = get(key)
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw)
    return v ?? fallback
  } catch {
    return fallback
  }
}

const str = (v) => (typeof v === 'string' ? v : '')

export function hasV2Data() {
  return V2_KEYS.some((k) => get(k) !== null)
}

export function clearV2Data() {
  for (const k of V2_KEYS) {
    try {
      localStorage.removeItem(k)
    } catch {
      // Storage blocked: nothing to clear.
    }
  }
}

export function readV2() {
  const session = json('kss_session_autosave', null)
  return {
    settings: json('kss_settings', {}),
    context: str(get('kss_global_context')),
    excludedNames: json('kss_excluded_names', []),
    theme: str(get('kss_theme')),
    memory: json('kss_caption_memory', []),
    session: session && typeof session === 'object' ? session : null,
    driveHistory: json('kss_drive_history', []),
    refLinks: json('kss_ref_links', []),
    planNotes: str(get('kss_plan_notes')),
    adContext: str(get('kss_ad_context')),
    adAudience: str(get('kss_ad_audience')),
  }
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return String(url || 'reference')
  }
}

const FORMAT_FROM_TYPE = { single: 'single', carousel: 'carousel', reel: 'reel', story: 'story' }

// Settings worth keeping. Model names and the old proxy are left behind on purpose:
// v3 has its own model list, and the old proxy was a constant, not a setting.
export function migrateSettings(v2, current) {
  const s = v2.settings && typeof v2.settings === 'object' ? v2.settings : {}
  const next = { ...current }
  for (const key of ['anthropicKey', 'googleKey', 'handle', 'hashtags', 'metaToken', 'igAccountId', 'adAccountId']) {
    // A value still at its default counts as unset, so the v2 handle wins over the stock one.
    const unset = !current[key] || current[key] === DEFAULT_SETTINGS[key]
    if (typeof s[key] === 'string' && s[key].trim() && unset) next[key] = s[key].trim()
  }
  if (!current.cloudName) next.cloudName = str(s.cloudName) || 'dsouvrzlr'
  if (!current.cloudPreset && s.cloudPreset && s.cloudPreset !== 'ml_default') next.cloudPreset = s.cloudPreset
  if (v2.theme === 'light' || v2.theme === 'dark') next.theme = v2.theme
  const history = Array.isArray(v2.driveHistory) ? v2.driveHistory.filter((x) => typeof x === 'string') : []
  if (history.length) next.driveHistory = [...new Set([...(current.driveHistory || []), ...history])].slice(0, 10)
  return next
}

// Fills `doc` (a fresh or existing workspace document) with the v2 plan and notes.
// Reference screenshots are stored as images, so this is async.
export async function migrateDoc(v2, doc) {
  const out = { ...doc }
  const summary = { posts: 0, themes: 0, references: 0, captions: 0 }
  const session = v2.session || {}

  const research = v2.context || str(session.globalContext)
  if (research && !out.research.text) out.research = { ...out.research, text: research, updatedAt: new Date().toISOString() }
  if (Array.isArray(v2.excludedNames)) out.excludedNames = [...new Set([...out.excludedNames, ...v2.excludedNames.filter((x) => typeof x === 'string')])]
  if (v2.planNotes && !out.planNotes) out.planNotes = v2.planNotes
  if (str(session.captionNotes) && !out.captionNotes) out.captionNotes = session.captionNotes
  if (v2.adContext && !out.adDraft.context) out.adDraft = { ...out.adDraft, context: v2.adContext }
  if (v2.adAudience && !out.brief.audience.summary) {
    out.brief = { ...out.brief, audience: { ...out.brief.audience, summary: v2.adAudience } }
  }

  const memory = (Array.isArray(v2.memory) ? v2.memory : [])
    .filter((m) => m && typeof m.caption === 'string' && m.caption.trim())
    .slice(0, 50)
    .map((m) => ({ caption: m.caption, voice: m.voice || 'documentary', theme: m.theme || '', ts: m.ts || Date.now() }))
  if (memory.length) out.captionMemory = [...memory, ...out.captionMemory].slice(0, 50)

  // Reference links and screenshots.
  const refs = []
  const newImages = []
  for (const raw of Array.isArray(v2.refLinks) ? v2.refLinks : []) {
    const entry = typeof raw === 'string' ? { url: raw } : raw
    if (!entry || typeof entry !== 'object') continue
    const addedAt = new Date().toISOString()
    if (typeof entry.thumb === 'string' && entry.thumb.startsWith('data:')) {
      try {
        const domain = entry.domain || 'reference'
        const processed = await processDataUrl(entry.thumb, { name: `${domain}.jpg`, role: 'reference', source: 'v2' })
        await storeImages([processed])
        newImages.push(processed.image)
        refs.push({ id: uid('r'), kind: 'screenshot', url: null, imageId: processed.image.id, title: domain, analysis: str(entry.analysis), error: null, addedAt })
      } catch {
        // A broken thumbnail is skipped; the rest still imports.
      }
    } else if (typeof entry.url === 'string' && entry.url) {
      refs.push({ id: uid('r'), kind: 'link', url: entry.url, imageId: null, title: entry.domain || domainOf(entry.url), analysis: str(entry.analysis), error: str(entry.error) || null, addedAt })
    }
  }
  if (newImages.length) out.images = [...out.images, ...newImages]
  if (refs.length) out.references = [...out.references, ...refs]
  summary.references = refs.length

  // Plan items become idea posts, in the same grid order.
  const themes = [...out.themes]
  const posts = []
  for (const item of Array.isArray(session.plan) ? session.plan : []) {
    if (!item || typeof item !== 'object') continue
    const caption = str(item.caption)
    const theme = str(item.theme).trim()
    const notes = str(item.notes)
    if (!caption && !theme && !notes) continue
    let kit = theme ? kitByName(themes, theme) : null
    if (theme && !kit && themes.length < MAX_KITS) {
      kit = emptyKit({ name: theme }, themes)
      themes.push(kit)
      summary.themes++
    }
    const post = newPost({ format: FORMAT_FROM_TYPE[item.type] || 'single', themeId: kit?.id || null, notes })
    post.caption = { ...post.caption, text: caption, hashtags: str(item.firstComment), approved: !!(item.captionApproved && caption) }
    if (caption) summary.captions++
    posts.push(post)
  }
  out.themes = themes
  if (posts.length) out.posts = [...posts, ...out.posts]
  summary.posts = posts.length
  return { doc: out, summary }
}

export function migrationMessage(summary) {
  const parts = []
  if (summary.posts) parts.push(`${summary.posts} posts`)
  if (summary.captions) parts.push(`${summary.captions} captions`)
  if (summary.themes) parts.push(`${summary.themes} themes`)
  if (summary.references) parts.push(`${summary.references} references`)
  if (!parts.length) return 'Old v2 settings imported.'
  return `Imported from v2: ${parts.join(', ')}. Images were never saved by v2 — re-import them in the Library.`
}
