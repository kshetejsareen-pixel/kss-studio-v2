// Pre-flight checks for a post before it is approved and scheduled. Pure: the Review step
// shows them, the test script exercises them.
import {
  CAPTION_LIMIT, MAX_HASHTAGS, MAX_SLIDES, byId, hashtagCount, isPublished, orientationOf,
} from '../data/model.js'
import { publishSlides } from './publish.js'

// [{ id, level: 'error' | 'warn' | 'info', text, step }] — `step` is where it gets fixed.
export function postChecks(post, doc, images = byId(doc.images)) {
  const out = []
  const add = (id, level, text, step) => out.push({ id, level, text, step })
  const story = post.format === 'story'

  if (post.format === 'reel') {
    if (!/^https:\/\//i.test(String(post.reel?.videoUrl || '').trim())) add('video', 'error', 'Reel needs a public https video URL.', 'plan')
  } else {
    const slides = publishSlides(post)
    if (!slides.length) add('images', 'error', 'No images yet.', 'plan')
    if (slides.length > MAX_SLIDES) add('slides', 'error', `${slides.length} slides — Instagram allows ${MAX_SLIDES}.`, 'plan')
    const missing = slides.filter((s) => !images.has(s.imageId)).length
    if (missing) add('missing', 'error', `${missing} image${missing > 1 ? 's were' : ' was'} deleted from the library.`, 'plan')
    if (post.format === 'carousel' && slides.length === 1) add('format', 'warn', 'Marked as a carousel but has one slide — it will post as a single image.', 'plan')
    if (post.format === 'single' && slides.length > 1) add('format', 'warn', `Marked as single but has ${slides.length} slides — it will post as a carousel.`, 'plan')
    if (!story && post.aspect !== '1.91:1') {
      const wide = post.slides.filter((s) => orientationOf(images.get(s.imageId)?.width, images.get(s.imageId)?.height) === 'landscape').length
      if (wide) add('orientation', 'info', `${wide} landscape photo${wide > 1 ? 's' : ''} cropped to ${post.aspect} — check the crop.`, 'plan')
    }
  }

  if (post.design?.html && !post.design.exportImageId) add('design', 'warn', 'Graphic designed but not exported — the plain photo will post.', 'create')

  const c = post.caption || {}
  const text = String(c.text || '')
  if (!story) {
    if (!text.trim()) add('caption', 'warn', 'No caption.', 'write')
    else if (!c.approved) add('caption-approved', 'info', 'Caption not marked approved in Write.', 'write')
    if (text.length > CAPTION_LIMIT) add('length', 'error', `Caption is ${text.length} characters — the limit is ${CAPTION_LIMIT}.`, 'write')
    const tags = hashtagCount(c)
    if (tags > MAX_HASHTAGS) add('hashtags', 'error', `${tags} hashtags — keep it to ${MAX_HASHTAGS}.`, 'write')
    if (text.trim() && c.briefVersion && doc.brief?.version && c.briefVersion < doc.brief.version) add('brief', 'info', 'Caption was written before the brief last changed.', 'write')
  }

  if (!isPublished(post)) {
    if (post.publish?.error) add('publish', 'error', post.publish.error, 'schedule')
    if (post.schedule?.at && Date.parse(post.schedule.at) < Date.now()) add('past', 'warn', 'Scheduled time has passed.', 'schedule')
  }
  return out
}

export const blocking = (checks) => checks.some((c) => c.level === 'error')

export function checkSummary(checks) {
  const errors = checks.filter((c) => c.level === 'error').length
  const warns = checks.filter((c) => c.level === 'warn').length
  return { errors, warns, ok: !errors && !warns }
}
