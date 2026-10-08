// Publishing: "Publish now" and the in-tab scheduler share publishNow(). The scheduler
// runs every 30 seconds in the primary tab only. A publish marks `startedAt` and saves
// before it talks to Instagram, so a tab closed mid-publish is noticed on the next run
// and flagged for a manual check instead of being posted twice.
import { useEffect, useRef } from 'react'
import { publishPost } from '../lib/publish.js'
import { metaConfigured } from '../lib/meta.js'
import { postLabel } from '../data/model.js'

const inFlight = new Set()
const STALE_MS = 5 * 60 * 1000
export const INTERRUPTED = 'Publishing was interrupted — check Instagram before retrying.'

const patchPost = (update, id, fn) =>
  update((d) => ({ ...d, posts: d.posts.map((p) => (p.id === id ? fn(p) : p)) }))

export const isPublishing = (id) => inFlight.has(id)

export async function publishNow(store, postId, { onStep } = {}) {
  if (inFlight.has(postId)) return null
  const post = store.getDoc().posts.find((p) => p.id === postId)
  if (!post || post.publish?.igMediaId) return null
  inFlight.add(postId)
  const label = postLabel(store.getDoc().posts, postId)
  patchPost(store.update, postId, (p) => ({ ...p, publish: { ...p.publish, error: null, startedAt: new Date().toISOString() } }))
  await store.flush()
  try {
    const out = await publishPost(post, { settings: store.settings, onStep })
    patchPost(store.update, postId, (p) => ({
      ...p,
      publish: { igMediaId: out.igMediaId, permalink: out.permalink, publishedAt: out.publishedAt, error: null, startedAt: null },
    }))
    await store.flush()
    store.toast(out.commentError ? `${label} published — the first comment failed: ${out.commentError}` : `${label} published`, { kind: out.commentError ? 'error' : 'success' })
    return out
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'Cancelled.' : err?.message || 'Publishing failed.'
    patchPost(store.update, postId, (p) => ({ ...p, publish: { ...p.publish, error: message, startedAt: null } }))
    await store.flush()
    store.toast(`${label}: ${message}`, { kind: 'error' })
    return null
  } finally {
    inFlight.delete(postId)
  }
}

export function clearPublishError(store, postId) {
  patchPost(store.update, postId, (p) => ({ ...p, publish: { ...p.publish, error: null, startedAt: null } }))
}

export function useScheduler(store) {
  const ref = useRef(store)
  ref.current = store
  const active = store.ready && store.isPrimary

  useEffect(() => {
    if (!active) return undefined
    let running = false
    const tick = async () => {
      if (running) return
      running = true
      try {
        const s = ref.current
        if (!metaConfigured(s.settings)) return
        const now = Date.now()
        const posts = s.getDoc().posts
        // Interrupted publishes: started long ago, never finished, not running here.
        const stale = posts.filter((p) => p.publish?.startedAt && !p.publish.igMediaId && !inFlight.has(p.id) && now - Date.parse(p.publish.startedAt) > STALE_MS)
        if (stale.length) {
          const ids = new Set(stale.map((p) => p.id))
          s.update((d) => ({ ...d, posts: d.posts.map((p) => (ids.has(p.id) ? { ...p, publish: { ...p.publish, error: INTERRUPTED, startedAt: null } } : p)) }))
        }
        const due = posts.filter((p) => p.approved && p.schedule?.at && Date.parse(p.schedule.at) <= now
          && !p.publish?.igMediaId && !p.publish?.error && !p.publish?.startedAt && !inFlight.has(p.id))
        for (const p of due) await publishNow(ref.current, p.id)
      } finally {
        running = false
      }
    }
    const first = setTimeout(tick, 5000)
    const timer = setInterval(tick, 30000)
    return () => { clearTimeout(first); clearInterval(timer) }
  }, [active])
}
