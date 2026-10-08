// Social graphics: Claude writes an HTML template with an [IMAGE_SRC] placeholder, the
// studio previews it in a locked-down iframe, and the server renders it to a JPEG.
// The template is what gets stored and refined; the photo is only injected for preview
// and export, so refine requests never carry the image.
import { askJson, askText } from './api.js'
import { DESIGN_FONTS_URL } from './fonts.js'
import { emit } from './runtime.js'
import { visionDataUrl, exportDataUrl } from '../data/media.js'
import {
  VISION_ANALYSIS_SYSTEM, REF_EXTRACT_SYSTEM, DESIGN_PLAN_SYSTEM, POST_SYSTEM, STORY_SYSTEM,
  COPY_SYSTEM, DESIGN_REFINE_SYSTEM,
} from './prompts.js'

export const DESIGN_SIZES = { post: [1080, 1350], story: [1080, 1920] }

export const INJECT_IMG = (html, dataUrl) => String(html || '')
  .replace(/\[IMAGE_SRC\]/g, dataUrl)
  .replace(/\[SUBJECT_IMAGE\]/g, dataUrl)
  .replace(/src="placeholder[^"]*"/g, `src="${dataUrl}"`)
  .replace(/src='placeholder[^']*'/g, `src='${dataUrl}'`)
  .replace(/url\("placeholder[^"]*"\)/g, `url("${dataUrl}")`)
  .replace(/url\('placeholder[^']*'\)/g, `url('${dataUrl}')`)
  .replace(/url\(placeholder[^)]*\)/g, `url("${dataUrl}")`)

export const stripFences = (text) => String(text || '')
  .replace(/^\s*```(?:html)?\s*/i, '')
  .replace(/\s*```\s*$/, '')
  .trim()

// Script tags and inline handlers never run in the sandboxed preview, but strip them so a
// stored template is clean before it reaches the export renderer too.
function scrub(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<(iframe|frame|object|embed|base|meta)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

const PREVIEW_CSP = "default-src 'none'; img-src data: blob: https://res.cloudinary.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com"

// A full document for <iframe sandbox="" srcdoc>. No scripts can run in it.
export function previewDoc(html, w, h) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">
<link rel="stylesheet" href="${DESIGN_FONTS_URL}">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${w}px;height:${h}px;overflow:hidden;background:#111}</style>
</head><body>${scrub(html)}</body></html>`
}

export async function analyseImage(imageId, { signal } = {}) {
  const url = await visionDataUrl(imageId, 1024)
  return askJson({
    tier: 'sonnet',
    system: VISION_ANALYSIS_SYSTEM,
    prompt: 'Analyse this image for copy generation.',
    images: [url],
    maxTokens: 1024,
    thinking: 'disabled',
    effort: 'low',
    signal,
  })
}

const COPY_KEYS = ['headline', 'sub', 'tagline', 'cta']

// Returns { headlines, copy } — locked fields keep their current text.
export async function generateCopy({
  imageId, context = '', handle, website, tone = '', analysis = null, visionDesc = '',
  copy = {}, lockedFields = [], signal,
}) {
  const lines = ['Generate copy for this image.']
  if (lockedFields.length) {
    lines.push(`Locked fields (preserve exactly): ${lockedFields.join(', ')}.`)
    for (const k of lockedFields) {
      const label = k === 'sub' ? 'subheadline' : k === 'cta' ? 'CTA' : k
      if (copy[k]) lines.push(`Keep ${label} as: "${copy[k]}"`)
    }
  }
  const images = imageId ? [await visionDataUrl(imageId, 1024)] : []
  const data = await askJson({
    tier: 'opus',
    system: COPY_SYSTEM(handle || '@kshetej.atwork', context, website, tone, analysis, visionDesc),
    prompt: lines.join('\n'),
    images,
    maxTokens: 4000,
    thinking: 'adaptive',
    effort: 'medium',
    signal,
  })
  const headlines = Array.isArray(data.headlines) ? data.headlines.filter(Boolean).map(String) : data.headline ? [String(data.headline)] : []
  const next = { ...copy }
  const fresh = { headline: headlines[0] || '', sub: data.sub || '', tagline: data.tagline || '', cta: data.cta || '' }
  for (const k of COPY_KEYS) if (!lockedFields.includes(k)) next[k] = fresh[k] || ''
  next.website = data.website || copy.website || website || ''
  return { headlines, copy: next }
}

// Runs the full pipeline. Returns the stored template plus everything it was built from.
export async function generateDesign({
  imageId, mode = 'post', copy = {}, context = '', handle, website, direction = '',
  refImageId = null, analysis = null, onStep, signal,
}) {
  const isStory = mode === 'story'
  const [w, h] = DESIGN_SIZES[isStory ? 'story' : 'post']
  const step = (s) => onStep?.(s)

  step('Analysing composition…')
  const imageAnalysis = analysis || await analyseImage(imageId, { signal })

  let refStyle = null
  if (refImageId) {
    step('Reading reference style…')
    refStyle = await askJson({
      tier: 'sonnet',
      system: REF_EXTRACT_SYSTEM,
      prompt: 'Extract the style spec from this reference design.',
      images: [await visionDataUrl(refImageId, 1024)],
      maxTokens: 1024,
      thinking: 'disabled',
      signal,
    }).catch((err) => {
      if (err?.name === 'AbortError') throw err
      return null
    })
  }

  step('Planning layout…')
  const hasCopy = !!copy.headline
  const planPrompt = [
    `Image analysis: ${JSON.stringify(imageAnalysis)}`,
    hasCopy ? `Copy: headline="${copy.headline}" sub="${copy.sub || ''}" cta="${copy.cta || ''}"` : 'No copy.',
    context ? `Brand brief: ${context.slice(0, 400)}` : '',
    refStyle ? `Reference style constraints: ${JSON.stringify(refStyle)}` : '',
    direction ? `Direction: ${direction}` : '',
    `Format: ${isStory ? '9:16 story (1080×1920)' : '4:5 post (1080×1350)'}`,
  ].filter(Boolean).join('\n')
  const plan = await askJson({
    tier: 'sonnet',
    system: DESIGN_PLAN_SYSTEM,
    prompt: planPrompt,
    maxTokens: 4000,
    thinking: 'adaptive',
    effort: 'medium',
    signal,
  })

  step('Generating design…')
  const system = isStory
    ? STORY_SYSTEM(handle, website, plan, hasCopy ? copy : null)
    : POST_SYSTEM(handle, website, plan, hasCopy ? copy : null)
  const raw = await askText({
    tier: 'opus',
    system,
    prompt: `Generate the ${isStory ? '1080×1920 Story' : '1080×1350 Post'} HTML now.\nUse src="[IMAGE_SRC]". Div must be exactly ${w}×${h}px. Return ONLY the HTML div.`,
    images: [await visionDataUrl(imageId, 1024)],
    maxTokens: 12000,
    thinking: 'adaptive',
    effort: 'high',
    signal,
  })
  const html = scrub(stripFences(raw))
  if (!/<div/i.test(html)) throw new Error('Claude did not return a design. Try again.')
  return { html, plan, analysis: imageAnalysis, refStyle }
}

export async function refineDesign(html, message, { signal } = {}) {
  const raw = await askText({
    tier: 'sonnet',
    system: DESIGN_REFINE_SYSTEM,
    prompt: `Current HTML design:\n\`\`\`html\n${html}\n\`\`\`\n\nChange requested: ${message}\n\nReturn the complete modified HTML div only.`,
    maxTokens: 8000,
    thinking: 'disabled',
    effort: 'medium',
    signal,
  })
  const next = scrub(stripFences(raw))
  if (!/<div/i.test(next)) throw new Error('Claude did not return a design. Try again.')
  return next
}

// Renders the template with the full-size photo on the server. Returns a JPEG blob.
export async function exportDesign(html, imageId, mode = 'post', { signal } = {}) {
  const [width, height] = DESIGN_SIZES[mode === 'story' ? 'story' : 'post']
  const body = JSON.stringify({ html: INJECT_IMG(html, await exportDataUrl(imageId)), width, height, format: 'jpeg' })
  if (body.length > 4_000_000) throw new Error('Design is too large to export — the photo is unusually big.')
  let res
  try {
    res = await fetch('/api/export-png', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new Error('Could not reach the export server.')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    if (data?.code === 'session') emit('kss:unauthed')
    if (res.status === 404) throw new Error('Export runs on the studio server — open the deployed app or run `vercel dev`.')
    throw new Error(data?.error || `Export failed (${res.status}).`)
  }
  return res.blob()
}
