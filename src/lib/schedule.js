// Calendar helpers for the Schedule step. Pure, all in IST.
import { istDateKey, istAt, addDays, weekdayOf } from './time.js'
import { isPublished } from '../data/model.js'

const LEAD_MS = 30 * 60 * 1000 // never auto-schedule closer than 30 minutes from now

// The next `count` open slot times (IST ISO strings) after `from`, one post per day at most,
// skipping days that already have something scheduled.
export function nextSlots(slots, count, { from = new Date(), taken = [] } = {}) {
  const days = new Set(slots.weekdays || [])
  if (!days.size || count <= 0) return []
  const busy = new Set(taken.filter(Boolean).map((t) => istDateKey(t)))
  const out = []
  let key = istDateKey(from)
  for (let i = 0; i < 400 && out.length < count; i++, key = addDays(key, 1)) {
    if (!days.has(weekdayOf(key)) || busy.has(key)) continue
    const at = istAt(key, slots.hour ?? 18, slots.minute ?? 0)
    if (Date.parse(at) < from.getTime() + LEAD_MS) continue
    out.push(at)
    busy.add(key)
  }
  return out
}

// Approved, unpublished posts with no time yet, in the order they should go out. The grid
// shows the newest post top-left, so the last post in the array is published first.
export function unscheduled(posts) {
  return posts.filter((p) => p.approved && !p.schedule?.at && !isPublished(p)).reverse()
}

// { postId: isoTime } for every unscheduled approved post.
export function autoSchedule(posts, slots, { from = new Date() } = {}) {
  const queue = unscheduled(posts)
  const taken = posts.filter((p) => p.schedule?.at && !isPublished(p)).map((p) => p.schedule.at)
  const times = nextSlots(slots, queue.length, { from, taken })
  return Object.fromEntries(queue.slice(0, times.length).map((p, i) => [p.id, times[i]]))
}

// Posts that would publish out of grid order: a post placed later in the grid (newer)
// scheduled before an older one. Returns the ids of the newer posts.
export function orderProblems(posts) {
  const timed = posts
    .map((p, i) => ({ p, i, t: Date.parse(p.schedule?.at || '') }))
    .filter(({ p, t }) => Number.isFinite(t) && !isPublished(p))
  const out = []
  for (const a of timed) {
    if (timed.some((b) => b.i > a.i && b.t > a.t)) out.push(a.p.id)
  }
  return out
}

// The status a scheduled post shows on the calendar.
export function slotStatus(post, { now = Date.now(), publishing = false } = {}) {
  if (isPublished(post)) return 'published'
  if (publishing || post.publish?.startedAt) return 'publishing'
  if (post.publish?.error) return 'error'
  if (!post.approved) return 'unapproved'
  if (post.schedule?.at && Date.parse(post.schedule.at) <= now) return 'due'
  return 'scheduled'
}
