// Claude helpers for the Brief, Library, Plan and Write steps. Each function takes the
// document (or ids) and returns plain data; the screens decide what to save.
import { askJson, askText, labelledImages, buildContent } from './api.js'
import { briefContext } from './brief.js'
import { visionDataUrl } from '../data/media.js'
import { mapLimit } from './pool.js'
import { hamming, colorDistance } from './image.js'
import {
  isPhoto, isWhiteBackground, isPublished, kitByName, newPost, slide, emptyKit,
  MAX_SLIDES, coverImageId, hashtagList, MAX_HASHTAGS,
} from '../data/model.js'
import {
  IMAGE_ANALYSIS_SYSTEM, IMAGE_ANALYSIS_PROMPT, THEME_KIT_SYSTEM, RESEARCH_SYSTEM, researchPrompt,
  LAYOUT_SYSTEM, layoutPrompt, SCREENSHOT_TEMPLATE_SYSTEM, SCREENSHOT_TEMPLATE_PROMPT, SHOTLIST_SYSTEM,
  shotListPrompt, PLAN_REFERENCE_RULES, planHardRules, PLAN_REFINE_SYSTEM, MIX_LABELS, HASHTAG_SYSTEM,
  CAPTION_SYSTEM, CAPTION_REFINE_SYSTEM, OPENERS_SYSTEM, VOICE_OPTIONS,
} from './prompts.js'

const PLAN_IMAGE_LIMIT = 40
const WHITE_RULE = /no white|don.?t use white|avoid white|without white|exclude white/i

// ---- Library --------------------------------------------------------------------------

// Describes each photo (subject, background, light, text space...). Results arrive one at a
// time through onResult so a long run saves as it goes.
export async function analyseImages(ids, { signal, onResult, onProgress } = {}) {
  let done = 0
  const out = await mapLimit(ids, 3, async (id) => {
    const image = await visionDataUrl(id, 768)
    const profile = await askJson({
      tier: 'haiku',
      system: IMAGE_ANALYSIS_SYSTEM,
      prompt: IMAGE_ANALYSIS_PROMPT,
      images: [image],
      maxTokens: 500,
      signal,
    })
    done += 1
    onProgress?.(done, ids.length)
    onResult?.(id, profile)
    return profile
  }, { signal })
  return { done: out.filter((r) => r?.value).length, errors: out.filter((r) => r?.error).map((r) => r.error) }
}

// Images most like `img`: perceptual hash first, then palette and Claude's description.
export function similarImages(img, images, n = 12) {
  const scored = images
    .filter((o) => o.id !== img.id && isPhoto(o))
    .map((o) => {
      let score = 0
      if (img.phash && o.phash) score += hamming(img.phash, o.phash) * 2
      else score += 40
      const a = img.palette?.[0]
      const b = o.palette?.[0]
      if (a && b) score += colorDistance(a, b) / 8
      const p = img.profile
      const q = o.profile
      if (p && q) {
        if (p.subject !== q.subject) score += 12
        if (p.background !== q.background) score += 8
        if (p.light !== q.light) score += 5
        if (p.mood !== q.mood) score += 5
      }
      return { image: o, score }
    })
  return scored.sort((x, y) => x.score - y.score).slice(0, n).map((s) => s.image)
}

// ---- Brief ------------------------------------------------------------------------------

// Groups up to 16 photos into 2–4 theme kits.
export async function draftThemes(doc, imageIds, { signal } = {}) {
  const ids = imageIds.slice(0, 16)
  if (!ids.length) throw new Error('Pick some photos first.')
  const images = await Promise.all(ids.map((id) => visionDataUrl(id, 512)))
  const context = briefContext(doc, { learnings: false })
  const content = [
    ...labelledImages(images),
    { type: 'text', text: `${context ? `Brief:\n${context}\n\n` : ''}Group these ${ids.length} photos into themes and return the JSON array.` },
  ]
  const raw = await askJson({ tier: 'opus', system: THEME_KIT_SYSTEM, content, maxTokens: 5000, effort: 'medium', signal })
  const list = Array.isArray(raw) ? raw : raw?.themes || []
  const kits = []
  for (const k of list) {
    if (!k || typeof k !== 'object') continue
    const refImageIds = (Array.isArray(k.images) ? k.images : [])
      .map((n) => ids[Number(n) - 1])
      .filter(Boolean)
    const { images: _drop, ...fields } = k
    kits.push(emptyKit({
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === 'string')),
      name: String(k.name || 'Theme').slice(0, 40),
      palette: Array.isArray(k.palette) ? k.palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6) : [],
      refImageIds,
    }, [...doc.themes, ...kits]))
  }
  return kits
}

export async function research(brand, { withSearch = true, signal } = {}) {
  const name = String(brand || '').trim()
  if (!name) throw new Error('Add the client or brand name first.')
  return askText({
    tier: 'sonnet',
    system: RESEARCH_SYSTEM,
    prompt: researchPrompt(name, withSearch),
    search: withSearch ? 4 : 0,
    maxTokens: 2000,
    effort: 'medium',
    signal,
  })
}

export async function analyseReferenceScreenshot(imageId, { signal } = {}) {
  const image = await visionDataUrl(imageId, 1200)
  const text = await askText({
    tier: 'sonnet',
    system: SCREENSHOT_TEMPLATE_SYSTEM,
    prompt: SCREENSHOT_TEMPLATE_PROMPT,
    images: [image],
    maxTokens: 1024,
    effort: 'low',
    thinking: 'disabled',
    signal,
  })
  return text.slice(0, 900)
}

export async function analyseLayoutUrl(url, { signal } = {}) {
  if (/pinterest\./i.test(url)) throw new Error('Pinterest requires login — upload a screenshot instead')
  try {
    const text = await askText({ tier: 'sonnet', system: LAYOUT_SYSTEM, prompt: layoutPrompt(url), fetch: true, maxTokens: 1200, signal })
    if (!text) throw new Error('empty')
    return text.slice(0, 900)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new Error('Could not analyse — upload a screenshot instead')
  }
}

export async function shotList(doc, { signal } = {}) {
  const context = briefContext(doc) || doc.brief.client || 'Luxury photography studio'
  const planned = doc.posts.filter((p) => p.slides.length).length
  return askJson({ tier: 'sonnet', system: SHOTLIST_SYSTEM, prompt: shotListPrompt(context, planned), maxTokens: 2500, effort: 'medium', signal })
}

// ---- Plan -------------------------------------------------------------------------------

// What Claude can fill: open slots (not published, not locked) and the photos that are free.
export function planScope(doc, { notes = '' } = {}) {
  const fixed = doc.posts.filter((p) => isPublished(p) || p.locked)
  const used = new Set(fixed.flatMap((p) => p.slides.map((s) => s.imageId)))
  const excludeWhite = WHITE_RULE.test(notes)
  const shortlist = new Set(doc.shortlist)
  let autoExcluded = 0
  const pool = doc.images.filter((img) => {
    if (!isPhoto(img) || img.cull === 'reject' || img.setAside || used.has(img.id)) return false
    if (excludeWhite && isWhiteBackground(img)) { autoExcluded += 1; return false }
    return true
  })
  // Shortlisted and picked photos first, then the rest in import order.
  pool.sort((a, b) => (shortlist.has(b.id) ? 1 : 0) - (shortlist.has(a.id) ? 1 : 0) || (b.cull === 'keep') - (a.cull === 'keep'))
  const images = pool.slice(0, PLAN_IMAGE_LIMIT)
  const slots = doc.posts.map((p, i) => ({ post: p, index: i })).filter(({ post }) => !isPublished(post) && !post.locked)
  return { images, slots, autoExcluded }
}

function imageLines(images) {
  return images.map((img, i) => {
    const p = img.profile
    const base = `${i + 1}. ${img.name} [${img.orientation}]`
    const tag = p?.background ? ` [bg:${p.background}]` : ''
    const desc = p?.summary ? ` — ${p.summary}${p.subject ? ` (${p.subject}, ${p.shot || ''})` : ''}` : ''
    return `${base}${tag}${desc}`
  }).join('\n')
}

function themeLines(doc) {
  if (!doc.themes.length) return ''
  return `Theme kits — use these exact names in "theme":\n${doc.themes.map((k) => `- ${k.name}${k.intent ? `: ${k.intent}` : ''}${k.gridPattern ? ` (grid: ${k.gridPattern})` : ''}`).join('\n')}`
}

// Turns Claude's plan items into slide lists, fixing 0-based answers and repeats.
export function readPlan(parsed, images, count) {
  const list = Array.isArray(parsed) ? parsed : []
  const nums = list.flatMap((p) => [p?.imageIndex, ...(Array.isArray(p?.slides) ? p.slides : [])]).filter((n) => typeof n === 'number')
  const shift = nums.length && Math.min(...nums) === 0 ? 1 : 0
  const seen = new Set()
  const take = (n) => {
    const i = typeof n === 'number' ? n + shift : Number.NaN
    if (!(i >= 1 && i <= images.length) || seen.has(i)) return null
    seen.add(i)
    return images[i - 1].id
  }
  const items = list.slice(0, count).map((p) => {
    const raw = Array.isArray(p?.slides) && p.slides.length ? p.slides : [p?.imageIndex ?? p?.image_index ?? p?.index]
    const ids = raw.map(take).filter(Boolean).slice(0, MAX_SLIDES)
    return { ids, type: p?.type === 'carousel' && ids.length > 1 ? 'carousel' : 'single', theme: String(p?.theme || ''), notes: String(p?.notes || '') }
  })
  while (items.length < count) items.push({ ids: [], type: 'single', theme: '', notes: '' })
  return items
}

// Writes plan items into the open slots and returns the new posts array.
export function applyPlan(doc, slots, items) {
  const posts = [...doc.posts]
  slots.forEach(({ post, index }, k) => {
    const item = items[k]
    if (!item) return
    const kit = kitByName(doc.themes, item.theme)
    posts[index] = {
      ...post,
      slides: item.ids.map((id) => slide(id)),
      format: item.ids.length > 1 ? 'carousel' : post.format === 'carousel' ? 'single' : post.format,
      themeId: kit?.id || post.themeId,
      notes: item.notes || (!kit && item.theme ? item.theme : post.notes),
      design: null,
    }
  })
  return posts
}

export async function planGrid(doc, { notes = '', mix = 'mixed', handle = '', signal } = {}) {
  const { images, slots, autoExcluded } = planScope(doc, { notes })
  if (!images.length) throw new Error('Import images first')
  if (!slots.length) throw new Error('Every slot is locked or posted — add a post or unlock one.')
  const count = slots.length
  const perPost = images.length / count
  const refs = doc.references.filter((r) => r.analysis || r.imageId || r.url)
  const shots = refs.filter((r) => r.imageId).slice(0, 3)
  const analysed = refs.filter((r) => r.analysis)
  const hasReference = shots.length > 0 || analysed.length > 0

  const system = [
    `You are a luxury Instagram content strategist planning a grid for ${handle || 'the studio'}.`,
    hasReference ? PLAN_REFERENCE_RULES : '',
    notes.trim() ? `DIRECTOR'S MANDATE — follow these instructions precisely:\n${notes.trim()}` : '',
    planHardRules(count),
  ].filter(Boolean).join('\n\n')

  const prompt = [
    `Plan an Instagram grid of ${count} posts. Position 1 is the top-left tile (the newest post); read left to right, top to bottom.`,
    `Brand context:\n${briefContext(doc) || 'None'}`,
    `Post format: 4:5 · Content mix: ${MIX_LABELS[mix] || MIX_LABELS.mixed}`,
    perPost >= 2
      ? `${images.length} available images across ${count} posts — use CAROUSELS (~${Math.ceil(perPost)} slides each, never more than ${MAX_SLIDES}).`
      : `${images.length} images, ${count} posts — 1 image per post.`,
    images.some((i) => i.orientation === 'landscape') ? 'IMPORTANT: Never mix landscape and portrait in the same carousel.' : '',
    themeLines(doc),
    `Available images — ONLY use indices from this list (1-based, each index once only):\n${imageLines(images)}`,
    analysed.length
      ? `REFERENCE SLOT TEMPLATE — assign your images to match this structure exactly:\n${analysed.map((r) => r.analysis).join('\n\n')}\n\nFor each slot: choose the available image whose content category and orientation best matches the template slot. Follow the PATTERN line precisely.`
      : '',
    shots.length ? 'The reference grid screenshot(s) are attached above. Use them to confirm the layout rhythm and content types per slot.' : '',
    `Return ONLY a JSON array of exactly ${count} objects:\n[{"imageIndex":1,"slides":[1,3],"type":"single|carousel","theme":"theme name","notes":"why this post, one line"}]`,
  ].filter(Boolean).join('\n\n')

  const content = []
  if (shots.length) {
    content.push({ type: 'text', text: `REFERENCE GRID SCREENSHOT${shots.length > 1 ? 'S' : ''} — study the layout: slot positions, content types, orientation pattern, alternation rhythm:` })
    const urls = await Promise.all(shots.map((r) => visionDataUrl(r.imageId, 1200).catch(() => null)))
    content.push(...buildContent('', urls.filter(Boolean)))
  }
  content.push({ type: 'text', text: prompt })

  const parsed = await askJson({ tier: 'sonnet', system, content, maxTokens: 4000, effort: 'medium', signal })
  const items = readPlan(parsed, images, count)
  const posts = applyPlan(doc, slots, items)
  const filled = items.filter((i) => i.ids.length).length
  return { posts, filled, total: count, autoExcluded }
}

export async function refinePlan(doc, instruction, { signal } = {}) {
  const { images, slots } = planScope(doc, { notes: instruction })
  if (!slots.length) throw new Error('Every slot is locked or posted.')
  const indexOf = new Map(images.map((img, i) => [img.id, i + 1]))
  // Photos already in open slots must be listed too, so the current plan can be described.
  for (const { post } of slots) {
    for (const s of post.slides) {
      if (!indexOf.has(s.imageId)) {
        const img = doc.images.find((i) => i.id === s.imageId)
        if (img) { images.push(img); indexOf.set(img.id, images.length) }
      }
    }
  }
  const current = slots.map(({ post }) => {
    const ids = post.slides.map((s) => indexOf.get(s.imageId)).filter(Boolean)
    return { imageIndex: ids[0] ?? null, slides: ids, type: ids.length > 1 ? 'carousel' : 'single', theme: doc.themes.find((k) => k.id === post.themeId)?.name || '', notes: post.notes || '' }
  })
  const prompt = [
    `Brand context:\n${briefContext(doc) || 'None'}`,
    themeLines(doc),
    `Current plan (${slots.length} posts): ${JSON.stringify(current)}`,
    `Available images:\n${imageLines(images)}`,
    `Director instruction: ${instruction}`,
    planHardRules(slots.length),
  ].filter(Boolean).join('\n\n')
  const parsed = await askJson({ tier: 'sonnet', system: PLAN_REFINE_SYSTEM, prompt, maxTokens: 4000, effort: 'medium', signal })
  const items = readPlan(parsed, images, slots.length)
  return { posts: applyPlan(doc, slots, items), filled: items.filter((i) => i.ids.length).length, total: slots.length }
}

// Adds n empty posts at the top of the grid (newest first).
export const blankPosts = (n) => Array.from({ length: n }, () => newPost())

// ---- Write ------------------------------------------------------------------------------

const voiceText = (id) => {
  const v = VOICE_OPTIONS.find((o) => o.id === id)
  return v ? `${v.label} — ${v.desc}` : id || 'documentary'
}

function memoryBlock(doc, voice) {
  const same = doc.captionMemory.filter((m) => m.voice === voice)
  const pool = (same.length ? same : doc.captionMemory).slice(0, 3)
  if (!pool.length) return ''
  return `\n\nApproved captions for this account:\n${pool.map((m, i) => `${i + 1}. ${m.caption}`).join('\n')}\nMatch this voice.`
}

async function captionInputs(doc, post) {
  const id = coverImageId(post)
  const image = id ? await visionDataUrl(id, 768).catch(() => null) : null
  const img = doc.images.find((i) => i.id === post.slides[0]?.imageId)
  const kit = doc.themes.find((k) => k.id === post.themeId)
  const facts = [
    `Format: ${post.format}${post.slides.length > 1 ? ` (${post.slides.length} slides)` : ''}`,
    kit ? `Theme: ${kit.name}${kit.captionTone ? ` — caption tone: ${kit.captionTone}` : ''}` : '',
    post.pillar ? `Content pillar: ${post.pillar}` : '',
    img?.profile?.summary ? `Image: ${img.profile.summary}` : '',
    post.notes ? `Post notes: ${post.notes}` : '',
    post.design?.copy?.headline ? `On-image headline: ${post.design.copy.headline}` : '',
  ].filter(Boolean).join('\n')
  const notes = [doc.captionNotes, post.caption.notes].filter((s) => s?.trim()).join('\n')
  return { image, facts, notes, context: briefContext(doc, { themeId: post.themeId }) }
}

export async function generateCaption(doc, post, { handle = '', signal } = {}) {
  const { image, facts, notes, context } = await captionInputs(doc, post)
  const voice = post.caption.voice || 'documentary'
  const system = CAPTION_SYSTEM(handle || 'the studio', context, voiceText(voice), notes) + memoryBlock(doc, voice)
  return askText({
    tier: 'sonnet',
    system,
    prompt: `${facts}\n\nWrite the caption for this post.`,
    images: image ? [image] : [],
    maxTokens: 1200,
    effort: 'medium',
    signal,
  })
}

export async function refineCaption(doc, post, instruction = '', { handle = '', signal } = {}) {
  const { facts, notes, context } = await captionInputs(doc, post)
  const voice = post.caption.voice || 'documentary'
  const system = CAPTION_REFINE_SYSTEM(handle || 'the studio', context, voiceText(voice), notes) + memoryBlock(doc, voice)
  return askText({
    tier: 'sonnet',
    system,
    prompt: `${facts}\n\nCaption:\n${post.caption.text}${instruction ? `\n\nDirector instruction: ${instruction}` : ''}`,
    maxTokens: 1200,
    effort: 'low',
    signal,
  })
}

export async function openers(doc, post, { signal } = {}) {
  if (!post.caption.text.trim()) throw new Error('Write or generate a caption first.')
  const out = await askJson({
    tier: 'sonnet',
    system: OPENERS_SYSTEM,
    prompt: `Brand context:\n${briefContext(doc, { themeId: post.themeId, research: false })}\n\nCaption:\n${post.caption.text}`,
    maxTokens: 1024,
    effort: 'low',
    thinking: 'disabled',
    signal,
  })
  return (Array.isArray(out) ? out : []).map(String).filter(Boolean).slice(0, 3)
}

export async function hashtags(doc, post, { signal } = {}) {
  const { image, facts } = await captionInputs(doc, post)
  const text = await askText({
    tier: 'sonnet',
    system: HASHTAG_SYSTEM(briefContext(doc, { learnings: false })),
    prompt: `${facts}${post.caption.text ? `\n\nCaption:\n${post.caption.text}` : ''}\n\nReturn the 5 hashtags.`,
    images: image ? [image] : [],
    maxTokens: 1024,
    effort: 'low',
    thinking: 'disabled',
    signal,
  })
  return hashtagList(text).slice(0, MAX_HASHTAGS).join(' ')
}

// Adds an approved caption to the memory the next captions learn from (newest first, max 50).
export function rememberCaption(doc, post) {
  const text = post.caption.text.trim()
  if (!text) return doc.captionMemory
  const kit = doc.themes.find((k) => k.id === post.themeId)
  const entry = { caption: text, voice: post.caption.voice, theme: kit?.name || '', ts: Date.now() }
  return [entry, ...doc.captionMemory.filter((m) => m.caption !== text)].slice(0, 50)
}
