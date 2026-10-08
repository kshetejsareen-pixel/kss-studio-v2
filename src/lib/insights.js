// Instagram insights: import the account's feed, fetch per-post metrics, keep 48-hour and
// 7-day snapshots on planned posts, and turn the numbers into rates, verdicts and
// breakdowns that the Measure step and the next plan can use.
import { graph, graphAll, MetaError } from './meta.js'
import { igTime } from './publish.js'
import { istParts, hoursSince } from './time.js'
import { askJson } from './api.js'
import { mapLimit } from './pool.js'
import { uid } from './ids.js'
import { LEARNINGS_SYSTEM, AB_SUGGEST_SYSTEM } from './prompts.js'
import { byId, postLabelAt, coverImageId, formatLabel } from '../data/model.js'

const FEED_FIELDS = 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count'

// Meta rejects a whole request (error #100) when one metric does not apply to a post, so
// each kind of post has a list of progressively smaller metric sets to try.
const FEED = ['reach', 'views', 'saved', 'shares', 'total_interactions', 'likes', 'comments', 'profile_visits', 'follows']
const FEED_SAFE = ['reach', 'views', 'saved', 'shares', 'total_interactions', 'likes', 'comments']
const MINIMAL = ['reach', 'saved', 'shares', 'total_interactions']
const REEL_EXTRA = ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time']
const METRIC_SETS = {
  FEED: [FEED, FEED_SAFE, MINIMAL],
  REELS: [[...FEED_SAFE, ...REEL_EXTRA, 'reels_skip_rate'], [...FEED_SAFE, ...REEL_EXTRA], FEED_SAFE, MINIMAL],
  STORY: [['reach', 'views', 'shares', 'total_interactions'], ['reach']],
}

export const METRIC_INFO = [
  { key: 'reach', label: 'Reach', kind: 'count', desc: 'Accounts that saw the post at least once. Every rate below is divided by reach, so posts of different sizes compare fairly.' },
  { key: 'views', label: 'Views', kind: 'count', desc: 'Times the post was shown, counting repeat views by the same account.' },
  { key: 'saveRate', label: 'Save rate', kind: 'rate', desc: 'Saves per account reached. The clearest sign a post is worth coming back to, and one Instagram weighs heavily.' },
  { key: 'shareRate', label: 'Share rate', kind: 'rate', desc: 'Shares to DMs and stories per account reached. Shares carry a post to people who do not follow you yet.' },
  { key: 'engagementRate', label: 'Engagement rate', kind: 'rate', desc: 'Likes, comments, saves and shares per account reached.' },
  { key: 'profileVisitRate', label: 'Profile visit rate', kind: 'rate', desc: 'Profile visits per account reached: curiosity about the studio. Feed posts only.' },
  { key: 'followsPer1k', label: 'Follows per 1k', kind: 'number', desc: 'New follows for every 1,000 accounts reached. Feed posts only.' },
  { key: 'avgWatch', label: 'Average watch', kind: 'seconds', desc: 'Average time people watched a reel. Reels only.' },
  { key: 'skipRate', label: 'Skip rate', kind: 'percent', desc: 'Share of reel views skipped in the first seconds. Lower is better: the opening holds attention. Reels only.' },
]

export const RATE_KEYS = ['reach', 'saveRate', 'shareRate', 'engagementRate', 'profileVisitRate', 'followsPer1k']

export const AB_CAVEAT = 'One test is a hint, not proof. Repeat it two or three times before changing the plan.'

const kindFor = (productType) => (productType === 'REELS' ? 'REELS' : productType === 'STORY' ? 'STORY' : 'FEED')
const productTypeOf = (post) => (post.format === 'reel' ? 'REELS' : post.format === 'story' ? 'STORY' : 'FEED')

export function formatFromFeed(item) {
  if (item.productType === 'REELS') return 'reel'
  if (item.productType === 'STORY') return 'story'
  if (item.mediaType === 'CAROUSEL_ALBUM') return 'carousel'
  return 'single'
}

function feedItem(m) {
  return {
    id: m.id,
    caption: m.caption || '',
    mediaType: m.media_type || 'IMAGE',
    productType: m.media_product_type || 'FEED',
    timestamp: igTime(m.timestamp),
    permalink: m.permalink || null,
    // Instagram's image links expire after a while; screens fall back to a placeholder.
    thumb: m.thumbnail_url || (m.media_type !== 'VIDEO' ? m.media_url : null) || null,
    likes: Number(m.like_count) || 0,
    comments: Number(m.comments_count) || 0,
    metrics: null,
    metricsAt: null,
  }
}

// Recent posts on the account, newest first.
export async function importFeed(settings, { signal, limit = 100 } = {}) {
  const ig = settings.igAccountId
  if (!ig) throw new MetaError('Add your Instagram account ID in Settings.', { kind: 'config' })
  const rows = await graphAll(`/${ig}/media`, { fields: FEED_FIELDS, limit: 50 }, { limit, signal })
  return rows.map(feedItem)
}

// Fresh feed rows keep the metrics already fetched; rows that dropped off the end stay.
export function mergeFeed(previous, fresh) {
  const old = byId(previous || [])
  const ids = new Set(fresh.map((it) => it.id))
  const merged = fresh.map((it) => {
    const o = old.get(it.id)
    return o ? { ...it, metrics: o.metrics, metricsAt: o.metricsAt } : it
  })
  for (const o of previous || []) if (!ids.has(o.id)) merged.push(o)
  return merged.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
}

export async function fetchInsights(mediaId, productType, { signal } = {}) {
  let lastErr = null
  for (const metrics of METRIC_SETS[kindFor(productType)]) {
    try {
      const d = await graph('GET', `/${mediaId}/insights`, { metric: metrics.join(',') }, { signal })
      const out = {}
      for (const row of d.data || []) {
        const v = row.values?.[0]?.value ?? row.total_value?.value ?? 0
        out[row.name] = Number(v) || 0
      }
      return out
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      lastErr = err
      if (!(err instanceof MetaError) || err.code !== 100) throw err
    }
  }
  throw lastErr
}

// Fetches metrics for recent feed posts and every published post in the plan. Returns
// what changed; applyInsights() writes it into the document so edits made while this
// runs are not lost.
export async function syncInsights(doc, settings, { signal, onProgress, refreshFeed = true, force = false, max = 60 } = {}) {
  let items = doc.feed.items
  if (refreshFeed) items = mergeFeed(items, await importFeed(settings, { signal }))

  const jobs = new Map()
  for (const it of items.slice(0, max)) {
    // Recently fetched numbers barely move; skip them unless asked.
    if (!force && it.metricsAt && hoursSince(it.metricsAt) < 1) continue
    jobs.set(it.id, it.productType)
  }
  for (const p of doc.posts) {
    const id = p.publish?.igMediaId
    if (!id || jobs.has(id)) continue
    const at = p.metrics?.latest?.at
    if (!force && at && hoursSince(at) < 1) continue
    // Story insights disappear after a day.
    if (p.format === 'story' && hoursSince(p.publish.publishedAt) > 24) continue
    jobs.set(id, productTypeOf(p))
  }

  const list = [...jobs.entries()]
  let done = 0
  onProgress?.(0, list.length)
  const at = new Date().toISOString()
  const settled = await mapLimit(list, 3, async ([id, type]) => {
    try {
      return await fetchInsights(id, type, { signal })
    } finally {
      onProgress?.(++done, list.length)
    }
  }, { signal })

  const results = {}
  const errors = []
  settled.forEach((r, i) => {
    const [id] = list[i]
    if (r.error) errors.push({ id, message: r.error.message })
    else results[id] = r.value
  })
  if (list.length && !Object.keys(results).length && errors.length) {
    throw new MetaError(errors[0].message)
  }
  return { fetchedAt: refreshFeed ? at : doc.feed.fetchedAt, items, results, at, errors }
}

function snapshot(values, at, publishedAt) {
  const ageHours = publishedAt ? Math.round(hoursSince(publishedAt)) : null
  return { ...values, at, ageHours }
}

export function applyInsights(doc, { fetchedAt, items, results, at }) {
  const feedItems = items.map((it) => (results[it.id] ? { ...it, metrics: results[it.id], metricsAt: at } : it))
  const stamps = byId(feedItems)
  const posts = doc.posts.map((p) => {
    const id = p.publish?.igMediaId
    if (!id || !results[id]) return p
    const publishedAt = p.publish.publishedAt || stamps.get(id)?.timestamp
    const snap = snapshot(results[id], at, publishedAt)
    const metrics = { ...p.metrics, latest: snap }
    if (!metrics.h48 && snap.ageHours >= 48) metrics.h48 = snap
    if (!metrics.d7 && snap.ageHours >= 168) metrics.d7 = snap
    return { ...p, metrics }
  })
  return { ...doc, feed: { fetchedAt, items: feedItems }, posts }
}

// ---- Numbers ------------------------------------------------------------------------

export function rates(m) {
  if (!m) return null
  const reach = Number(m.reach) || 0
  const per = (v) => (reach > 0 ? (Number(v) || 0) / reach : 0)
  return {
    reach,
    views: m.views == null ? null : Number(m.views) || 0,
    saveRate: m.saved == null ? null : per(m.saved),
    shareRate: m.shares == null ? null : per(m.shares),
    engagementRate: m.total_interactions == null ? null : per(m.total_interactions),
    profileVisitRate: m.profile_visits == null ? null : per(m.profile_visits),
    followsPer1k: m.follows == null ? null : per(m.follows) * 1000,
    avgWatch: m.ig_reels_avg_watch_time == null ? null : m.ig_reels_avg_watch_time / 1000,
    skipRate: m.reels_skip_rate == null ? null : m.reels_skip_rate,
  }
}

export function median(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

// above / typical / below the account's usual, using a ±20% band.
export function verdict(value, baseline) {
  if (value == null || baseline == null || !(baseline > 0)) return null
  const r = value / baseline
  if (r >= 1.2) return 'above'
  if (r <= 0.8) return 'below'
  return 'typical'
}

export const VERDICT_LABELS = { above: 'Above usual', typical: 'Typical', below: 'Below usual' }

export function formatMetric(value, kind) {
  if (value == null || !Number.isFinite(value)) return '–'
  if (kind === 'rate') return `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`
  if (kind === 'percent') return `${value.toFixed(1)}%`
  if (kind === 'seconds') return `${value.toFixed(1)}s`
  if (kind === 'number') return value.toFixed(1)
  return new Intl.NumberFormat('en-IN', { notation: value >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

export const metricInfo = (key) => METRIC_INFO.find((m) => m.key === key) || { key, label: key, kind: 'number', desc: '' }

// One row per published post, joining the account feed with the plan. Newest first.
export function measureRows(doc) {
  const planned = new Map()
  doc.posts.forEach((p, index) => {
    if (p.publish?.igMediaId) planned.set(p.publish.igMediaId, { post: p, index })
  })
  const rows = []
  const seen = new Set()
  const row = (it, hit) => {
    const post = hit?.post || null
    const metrics = post?.metrics?.latest || it?.metrics || null
    return {
      id: it?.id || post.publish.igMediaId,
      postId: post?.id || null,
      label: hit ? postLabelAt(doc.posts, hit.index) : null,
      imageId: post ? coverImageId(post) : null,
      thumbUrl: it?.thumb || null,
      caption: post?.caption?.text || it?.caption || '',
      timestamp: post?.publish?.publishedAt || it?.timestamp || null,
      permalink: it?.permalink || post?.publish?.permalink || null,
      format: post?.format || (it ? formatFromFeed(it) : 'single'),
      themeId: post?.themeId || null,
      pillar: post?.pillar || '',
      likes: it?.likes ?? metrics?.likes ?? null,
      comments: it?.comments ?? metrics?.comments ?? null,
      metrics,
      rates: rates(metrics),
      snapshots: post ? { h48: post.metrics.h48, d7: post.metrics.d7 } : null,
    }
  }
  for (const it of doc.feed.items) {
    seen.add(it.id)
    rows.push(row(it, planned.get(it.id)))
  }
  for (const [id, hit] of planned) if (!seen.has(id)) rows.push(row(null, hit))
  return rows.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
}

// The account's usual numbers: medians over the latest `n` posts with data.
export function baselines(rows, n = 20) {
  const recent = rows.filter((r) => r.rates && r.rates.reach > 0).slice(0, n)
  const out = { count: recent.length }
  for (const k of [...RATE_KEYS, 'avgWatch', 'skipRate']) out[k] = median(recent.map((r) => r.rates[k]))
  return out
}

export const BREAKDOWNS = {
  theme: { label: 'Theme', key: (r) => r.themeId },
  format: { label: 'Format', key: (r) => r.format },
  pillar: { label: 'Pillar', key: (r) => r.pillar || null },
  hour: { label: 'Hour (IST)', key: (r) => (r.timestamp ? istParts(r.timestamp)?.hour ?? null : null) },
  weekday: { label: 'Weekday', key: (r) => (r.timestamp ? istParts(r.timestamp)?.weekday ?? null : null) },
}

export function breakdown(rows, by, metric = 'saveRate') {
  const keyOf = BREAKDOWNS[by]?.key
  if (!keyOf) return []
  const groups = new Map()
  for (const r of rows) {
    const v = r.rates?.[metric]
    if (v == null || !(r.rates.reach > 0)) continue
    const k = keyOf(r)
    if (k == null || k === '') continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(v)
  }
  return [...groups.entries()]
    .map(([key, values]) => ({ key, count: values.length, median: median(values) }))
    .sort((a, b) => b.median - a.median)
}

// Best weekdays and hour by engagement rate, once there is enough history to say.
export function suggestedSlots(rows, { days = 3, minPosts = 8 } = {}) {
  const measured = rows.filter((r) => r.rates?.engagementRate != null && r.rates.reach > 0)
  if (measured.length < minPosts) return null
  const weekdays = breakdown(measured, 'weekday', 'engagementRate').filter((g) => g.count >= 2).slice(0, days).map((g) => g.key)
  const hours = breakdown(measured, 'hour', 'engagementRate').filter((g) => g.count >= 2)
  if (!weekdays.length || !hours.length) return null
  return { weekdays: weekdays.sort((a, b) => a - b), hour: hours[0].key, basis: measured.length }
}

// ---- Claude: learnings and tests ----------------------------------------------------

const opening = (text) => String(text || '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 140) || ''
const pct = (v) => (v == null ? null : Math.round(v * 10000) / 100)

export async function generateLearnings(doc, settings, { signal } = {}) {
  const themes = byId(doc.themes)
  const data = measureRows(doc)
    .filter((r) => r.rates && r.rates.reach > 0)
    .slice(0, 40)
    .map((r) => {
      const t = r.timestamp ? istParts(r.timestamp) : null
      return {
        post: r.label || `feed ${r.id.slice(-5)}`,
        format: formatLabel(r.format),
        theme: themes.get(r.themeId)?.name || '',
        pillar: r.pillar,
        posted: t ? `${t.weekdayName} ${String(t.hour).padStart(2, '0')}:00 IST` : '',
        reach: r.rates.reach,
        savePct: pct(r.rates.saveRate),
        sharePct: pct(r.rates.shareRate),
        engagementPct: pct(r.rates.engagementRate),
        profileVisitPct: pct(r.rates.profileVisitRate),
        followsPer1k: r.rates.followsPer1k == null ? null : Math.round(r.rates.followsPer1k * 10) / 10,
        opening: opening(r.caption),
      }
    })
  if (!data.length) throw new Error('No posts with insights yet. Sync insights first.')
  const res = await askJson({
    tier: 'sonnet',
    system: LEARNINGS_SYSTEM,
    prompt: `Account: ${settings.handle || ''}\nPosts, newest first (rates are percentages of reach):\n${JSON.stringify(data)}`,
    maxTokens: 6000,
    effort: 'high',
    thinking: 'adaptive',
    signal,
  })
  const createdAt = new Date().toISOString()
  const learnings = (Array.isArray(res?.learnings) ? res.learnings : [])
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .slice(0, 5)
    .map((l) => ({
      id: uid('l'),
      text: l.text.trim(),
      evidence: String(l.evidence || ''),
      confidence: ['high', 'medium', 'low'].includes(l.confidence) ? l.confidence : 'low',
      active: true,
      createdAt,
    }))
  return {
    summary: String(res?.summary || ''),
    next: (Array.isArray(res?.next) ? res.next : []).map(String).slice(0, 5),
    learnings,
    basis: data.length,
  }
}

export const TEST_METRICS = ['saveRate', 'shareRate', 'engagementRate', 'reach', 'profileVisitRate']

export async function suggestTest(doc, post, metric = 'saveRate', { signal } = {}) {
  const theme = doc.themes.find((k) => k.id === post.themeId)?.name || 'none'
  const img = doc.images.find((i) => i.id === coverImageId(post))
  const prompt = [
    `Format: ${formatLabel(post.format)}${post.slides.length > 1 ? ` (${post.slides.length} slides)` : ''}`,
    `Theme: ${theme}`,
    `Caption opening: "${opening(post.caption.text) || 'not written yet'}"`,
    `Image: ${img?.profile?.summary || img?.name || 'not described'}`,
    `Metric to improve: ${metric}`,
  ].join('\n')
  const res = await askJson({ tier: 'sonnet', system: AB_SUGGEST_SYSTEM, prompt, maxTokens: 1024, effort: 'medium', thinking: 'disabled', signal })
  return {
    id: uid('t'),
    name: String(res?.name || 'A/B test'),
    hypothesis: String(res?.hypothesis || ''),
    change: String(res?.change || ''),
    metric: TEST_METRICS.includes(res?.metric) ? res.metric : metric,
    aPostId: post.id,
    bPostId: null,
    status: 'draft',
    createdAt: new Date().toISOString(),
  }
}

// Compares variant B against A on the test's metric. A difference of 10% or less is a tie.
export function compareTest(test, rowsByPost) {
  const a = rowsByPost.get(test.aPostId)?.rates?.[test.metric]
  const b = rowsByPost.get(test.bPostId)?.rates?.[test.metric]
  if (a == null || b == null) return { status: 'waiting', a: a ?? null, b: b ?? null, diff: null }
  if (!(a > 0)) return { status: b > 0 ? 'b' : 'tie', a, b, diff: null }
  const diff = (b - a) / a
  if (Math.abs(diff) <= 0.1) return { status: 'tie', a, b, diff }
  return { status: diff > 0 ? 'b' : 'a', a, b, diff }
}
