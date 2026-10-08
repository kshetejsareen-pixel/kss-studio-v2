// Publishing a post to Instagram: render each slide at its exact size, upload it to
// Cloudinary, create the media container(s), wait for Instagram to process them, publish,
// then post the first comment.
import { graph, MetaError } from './meta.js'
import { uploadImage } from './cloudinary.js'
import { decodeImage, cropToBlob } from './image.js'
import { getFullBlob } from '../data/media.js'
import { PUBLISH_SIZES, DEFAULT_CROP, MAX_SLIDES, captionForPublish, firstCommentForPublish } from '../data/model.js'

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

// Instagram timestamps look like 2026-10-08T10:00:00+0000; Safari needs +00:00.
export const igTime = (ts) => (ts ? new Date(String(ts).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')).toISOString() : null)

export async function publishingLimit(igId, { signal } = {}) {
  const d = await graph('GET', `/${igId}/content_publishing_limit`, { fields: 'config,quota_usage' }, { signal })
  const row = d.data?.[0] || {}
  return { used: Number(row.quota_usage) || 0, total: Number(row.config?.quota_total) || 100 }
}

// The slides a post publishes, with the exported design replacing slide 1.
export function publishSlides(post) {
  const slides = post.slides.map((s) => ({ imageId: s.imageId, crop: s.crop }))
  if (post.design?.exportImageId) {
    const d = { imageId: post.design.exportImageId, crop: DEFAULT_CROP }
    if (slides.length) slides[0] = d
    else slides.push(d)
  }
  return slides
}

export const publishAspect = (post) => (post.format === 'story' ? '9:16' : PUBLISH_SIZES[post.aspect] ? post.aspect : '4:5')

export async function renderSlide(imageId, crop, aspect) {
  const blob = await getFullBlob(imageId)
  if (!blob) throw new Error('An image in this post is missing from storage — re-import it in the Library.')
  const decoded = await decodeImage(blob)
  try {
    const [W, H] = PUBLISH_SIZES[aspect] || PUBLISH_SIZES['4:5']
    return await cropToBlob(decoded, crop || DEFAULT_CROP, W, H, 0.92)
  } finally {
    decoded.close()
  }
}

async function waitForContainer(id, { signal, tries = 40, every = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const d = await graph('GET', `/${id}`, { fields: 'status_code,status' }, { signal })
    if (d.status_code === 'FINISHED' || d.status_code === 'PUBLISHED') return
    if (d.status_code === 'ERROR' || d.status_code === 'EXPIRED') {
      throw new MetaError(`Instagram could not process the media (${d.status || d.status_code}).`)
    }
    await sleep(every, signal)
  }
  throw new MetaError('Instagram is still processing the media — try again in a few minutes.')
}

// Returns { igMediaId, permalink, publishedAt, commentError }.
export async function publishPost(post, { settings, onStep, signal } = {}) {
  const ig = settings.igAccountId
  if (!ig) throw new MetaError('Add your Instagram account ID in Settings.', { kind: 'config' })
  const step = (s) => onStep?.(s)

  step('Checking the daily limit…')
  const limit = await publishingLimit(ig, { signal }).catch((err) => {
    if (err?.name === 'AbortError') throw err
    return null
  })
  if (limit && limit.used >= limit.total) {
    throw new MetaError(`Instagram's limit of ${limit.total} posts per 24 hours is reached. Try again later.`, { kind: 'rate' })
  }

  const caption = captionForPublish(post.caption)
  let creationId
  let processing = { tries: 40, every: 3000 }

  if (post.format === 'reel') {
    const videoUrl = String(post.reel?.videoUrl || '').trim()
    if (!/^https:\/\//i.test(videoUrl)) throw new MetaError('Add the public https video URL for this reel.', { kind: 'config' })
    const params = { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: true }
    if (post.reel.coverUrl) params.cover_url = post.reel.coverUrl
    if (post.reel.trial) params.trial_params = { graduation_strategy: 'SS_PERFORMANCE' }
    step('Sending the video to Instagram…')
    creationId = (await graph('POST', `/${ig}/media`, params, { signal })).id
    processing = { tries: 120, every: 5000 }
  } else {
    const slides = publishSlides(post)
    if (!slides.length) throw new MetaError('This post has no images.', { kind: 'config' })
    if (slides.length > MAX_SLIDES) throw new MetaError(`A carousel can have at most ${MAX_SLIDES} slides.`, { kind: 'config' })
    const aspect = publishAspect(post)
    const use = post.format === 'story' ? slides.slice(0, 1) : slides
    const urls = []
    for (let i = 0; i < use.length; i++) {
      step(`Preparing image ${i + 1} of ${use.length}…`)
      const blob = await renderSlide(use[i].imageId, use[i].crop, aspect)
      step(`Uploading image ${i + 1} of ${use.length}…`)
      urls.push((await uploadImage(blob, { signal, filename: `slide-${i + 1}.jpg` })).url)
    }
    if (post.format === 'story') {
      step('Creating the story…')
      creationId = (await graph('POST', `/${ig}/media`, { media_type: 'STORIES', image_url: urls[0] }, { signal })).id
    } else if (urls.length === 1) {
      step('Creating the post…')
      creationId = (await graph('POST', `/${ig}/media`, { image_url: urls[0], caption }, { signal })).id
    } else {
      const children = []
      for (let i = 0; i < urls.length; i++) {
        step(`Creating slide ${i + 1} of ${urls.length}…`)
        const child = await graph('POST', `/${ig}/media`, { image_url: urls[i], is_carousel_item: true }, { signal })
        children.push(child.id)
      }
      for (const id of children) await waitForContainer(id, { signal })
      step('Creating the carousel…')
      creationId = (await graph('POST', `/${ig}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, { signal })).id
    }
  }

  step('Waiting for Instagram to process…')
  await waitForContainer(creationId, { signal, ...processing })
  step('Publishing…')
  const mediaId = (await graph('POST', `/${ig}/media_publish`, { creation_id: creationId }, { signal })).id
  const info = await graph('GET', `/${mediaId}`, { fields: 'permalink,timestamp' }).catch(() => ({}))

  let commentError = null
  const first = firstCommentForPublish(post.caption)
  if (first && post.format !== 'story') {
    step('Adding the first comment…')
    try {
      await graph('POST', `/${mediaId}/comments`, { message: first })
    } catch (err) {
      commentError = err.message
    }
  }
  return {
    igMediaId: mediaId,
    permalink: info.permalink || null,
    publishedAt: igTime(info.timestamp) || new Date().toISOString(),
    commentError,
  }
}
