// The workspace document and the shapes inside it. One document per workspace, saved
// to IndexedDB as a whole. Image pixels live separately in the `blobs` store.
import { uid } from '../lib/ids.js'

export const STEPS = [
  { id: 'brief', label: 'Brief', hint: 'Who, what, how it should feel', icon: 'brief' },
  { id: 'library', label: 'Library', hint: 'Import, cull, analyse', icon: 'library' },
  { id: 'plan', label: 'Plan', hint: 'Arrange the grid', icon: 'grid' },
  { id: 'create', label: 'Create', hint: 'Design graphics', icon: 'create' },
  { id: 'write', label: 'Write', hint: 'Captions and hashtags', icon: 'write' },
  { id: 'review', label: 'Review', hint: 'Check and approve', icon: 'review' },
  { id: 'schedule', label: 'Schedule', hint: 'Calendar and publishing', icon: 'calendar' },
  { id: 'measure', label: 'Measure', hint: 'Insights and learnings', icon: 'chart' },
]

export const EXTRA_STEPS = [
  { id: 'promote', label: 'Promote', hint: 'Boost posts and run ads', icon: 'megaphone' },
  { id: 'settings', label: 'Settings', hint: 'Connections and data', icon: 'settings' },
]

export const ROUTES = [...STEPS, ...EXTRA_STEPS].map((s) => s.id)

export const stepInfo = (id) => [...STEPS, ...EXTRA_STEPS].find((s) => s.id === id) || STEPS[0]

export function nextStep(id) {
  const i = STEPS.findIndex((s) => s.id === id)
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null
}

// Never written into backups or shown back in full.
export const SECRET_KEYS = ['anthropicKey', 'metaToken', 'googleKey', 'proxySecret']

export const DEFAULT_SETTINGS = {
  anthropicKey: '',
  proxyUrl: '',
  proxySecret: '',
  googleKey: '',
  metaToken: '',
  igAccountId: '',
  adAccountId: '',
  pageId: '',
  website: 'www.kshetejsareen.com',
  handle: '@kshetej.atwork',
  hashtags: '',
  cloudName: '',
  cloudPreset: '',
  models: {},
  theme: 'dark',
  driveHistory: [],
  fallbackNoticeShown: false,
}

export const FORMATS = [
  { id: 'single', label: 'Single' },
  { id: 'carousel', label: 'Carousel' },
  { id: 'reel', label: 'Reel' },
  { id: 'story', label: 'Story' },
]

export const formatLabel = (id) => FORMATS.find((f) => f.id === id)?.label || 'Single'

// Width / height of each frame shape.
export const ASPECTS = { '4:5': 0.8, '1:1': 1, '1.91:1': 1.91, '9:16': 0.5625, '3:4': 0.75 }
export const POST_ASPECTS = ['4:5', '1:1', '1.91:1']
// The profile grid has shown 3:4 tiles since January 2025.
export const GRID_RATIOS = ['3:4', '4:5', '1:1']
export const PUBLISH_SIZES = { '4:5': [1080, 1350], '1:1': [1080, 1080], '1.91:1': [1080, 566], '9:16': [1080, 1920] }
export const DEFAULT_CROP = { x: 0.5, y: 0.5, zoom: 1 }
export const MAX_SLIDES = 10
export const MAX_HASHTAGS = 5
export const CAPTION_LIMIT = 2200

export const KIT_COLORS = ['#C9A96E', '#7A9CC6', '#9C7AC6', '#6EC9A0', '#C67A7A', '#C6B87A', '#7AC6C2', '#B07AC6', '#8FA37A', '#C6967A', '#7A86C6', '#A3A3A3']
export const MAX_KITS = 12

export function emptyBrief() {
  return {
    client: '',
    offer: '',
    category: '',
    goals: [],
    goal: '',
    target: '',
    audience: { summary: '', ageMin: 25, ageMax: 55, genders: [], locations: [], interests: [] },
    pillars: [],
    voice: '',
    dos: '',
    donts: '',
    competitors: '',
    reading: [],
    cta: '',
    cadence: { perWeek: 3, mix: { single: 40, carousel: 40, reel: 20 } },
    keyDates: [],
    version: 1,
    updatedAt: null,
  }
}

export function emptyKit(fields = {}, existing = []) {
  const used = new Set(existing.map((k) => k.color))
  const color = KIT_COLORS.find((c) => !used.has(c)) || KIT_COLORS[existing.length % KIT_COLORS.length]
  return {
    id: uid('k'),
    name: 'New theme',
    color,
    intent: '',
    palette: [],
    light: '',
    composition: '',
    subjects: '',
    type: '',
    devices: '',
    mood: '',
    do: '',
    dont: '',
    references: '',
    notThis: '',
    captionTone: '',
    gridPattern: '',
    success: '',
    refImageIds: [],
    ...fields,
  }
}

export function emptyAdDraft() {
  return {
    mode: 'new',
    imageId: null,
    crop: null,
    boostPostId: null, // the Instagram media id of the post to boost
    placement: 'feed',
    objective: 'OUTCOME_AWARENESS',
    funnel: 'tofu',
    advPlus: false,
    context: '',
    audience: '',
    variants: [],
    selected: 0,
    cta: 'LEARN_MORE',
    targeting: { ageMin: 25, ageMax: 55, genders: [], cities: [], interests: [], country: 'IN' },
    budgetDaily: 1000,
    ongoing: true,
    startDate: '',
    endDate: '',
    resolved: {},
  }
}

export function emptyDoc() {
  return {
    v: 3,
    brief: emptyBrief(),
    briefVersions: [],
    themes: [],
    images: [],
    posts: [],
    shortlist: [],
    research: { text: '', citations: [], useInPrompts: true, updatedAt: null },
    references: [],
    learnings: [],
    insightSummary: { summary: '', next: [], at: null },
    captionMemory: [],
    ads: [],
    adDraft: emptyAdDraft(),
    feed: { fetchedAt: null, items: [] },
    shotList: null,
    planNotes: '',
    planMix: 'mixed',
    captionNotes: '',
    gridRatio: '3:4',
    scheduleSlots: { weekdays: [1, 3, 5], hour: 18, minute: 0 },
    tests: [],
    excludedNames: [],
  }
}

const IMAGE_DEFAULTS = {
  name: '',
  width: 0,
  height: 0,
  orientation: 'portrait',
  mime: 'image/jpeg',
  bytes: 0,
  source: 'upload',
  driveId: null,
  setAside: false,
  cull: null,
  tags: [],
  themeId: null,
  role: null,
  profile: null,
  analysedAt: null,
  palette: [],
  brightness: 0,
  contrast: 0,
  warmth: 0,
  phash: '',
  dupOf: null,
  remoteUrl: null,
}

export function newImage(fields = {}) {
  return { id: uid('i'), ...IMAGE_DEFAULTS, addedAt: new Date().toISOString(), ...fields }
}

export function emptyDesign() {
  return {
    html: '',
    mode: 'post',
    copy: { headline: '', sub: '', tagline: '', cta: '', website: '' },
    headlines: [],
    lockedFields: [],
    tone: '',
    direction: '',
    customDirection: '',
    refImageId: null,
    refStyle: null,
    analysis: null,
    plan: null,
    versions: [],
    exportImageId: null,
    exportUrl: null,
    slideIndex: 0,
    variants: [],
  }
}

export function newPost(fields = {}) {
  return {
    id: uid('p'),
    format: 'single',
    aspect: '4:5',
    slides: [],
    themeId: null,
    pillar: '',
    notes: '',
    locked: false,
    approved: false,
    reel: { videoUrl: '', coverUrl: '', trial: false },
    design: null,
    caption: {
      text: '',
      voice: 'documentary',
      hashtags: '',
      firstComment: '',
      hashtagMode: 'comment',
      approved: false,
      notes: '',
      briefVersion: null,
    },
    schedule: { at: '' },
    publish: { igMediaId: null, permalink: null, publishedAt: null, error: null, startedAt: null },
    metrics: { h48: null, d7: null, latest: null },
    createdAt: new Date().toISOString(),
    ...fields,
  }
}

export const slide = (imageId, crop) => ({ imageId, crop: { ...DEFAULT_CROP, ...(crop || {}) } })

// Fills in anything a stored or restored document is missing, so screens can rely on shapes.
export function normalizeDoc(raw) {
  const base = emptyDoc()
  const src = raw && typeof raw === 'object' ? raw : {}
  const doc = { ...base, ...src, v: 3 }
  const b = src.brief || {}
  doc.brief = {
    ...base.brief,
    ...b,
    audience: { ...base.brief.audience, ...(b.audience || {}) },
    cadence: { ...base.brief.cadence, ...(b.cadence || {}), mix: { ...base.brief.cadence.mix, ...(b.cadence?.mix || {}) } },
    pillars: Array.isArray(b.pillars) ? b.pillars : [],
    keyDates: Array.isArray(b.keyDates) ? b.keyDates : [],
    goals: Array.isArray(b.goals) ? b.goals : [],
    reading: Array.isArray(b.reading) ? b.reading : [],
  }
  doc.research = { ...base.research, ...(src.research || {}) }
  doc.feed = { ...base.feed, ...(src.feed || {}) }
  if (!Array.isArray(doc.feed.items)) doc.feed.items = []
  doc.scheduleSlots = { ...base.scheduleSlots, ...(src.scheduleSlots || {}) }
  if (!Array.isArray(doc.scheduleSlots.weekdays)) doc.scheduleSlots.weekdays = base.scheduleSlots.weekdays
  doc.insightSummary = { ...base.insightSummary, ...(src.insightSummary || {}) }
  if (!Array.isArray(doc.insightSummary.next)) doc.insightSummary.next = []
  const ad = src.adDraft || {}
  doc.adDraft = {
    ...base.adDraft,
    ...ad,
    targeting: { ...base.adDraft.targeting, ...(ad.targeting || {}) },
    resolved: { ...(ad.resolved || {}) },
  }
  for (const key of ['briefVersions', 'themes', 'images', 'posts', 'shortlist', 'references', 'learnings', 'captionMemory', 'ads', 'tests', 'excludedNames']) {
    if (!Array.isArray(doc[key])) doc[key] = []
  }
  doc.images = doc.images.filter((img) => img && img.id).map((img) => ({ ...IMAGE_DEFAULTS, ...img }))
  doc.posts = doc.posts.filter(Boolean).map(normalizePost)
  doc.themes = doc.themes.filter((k) => k && k.id).map((k) => ({ ...emptyKit({}, []), ...k }))
  if (!GRID_RATIOS.includes(doc.gridRatio)) doc.gridRatio = '3:4'
  return doc
}

export function normalizePost(p) {
  const base = newPost({ id: p.id || uid('p') })
  return {
    ...base,
    ...p,
    slides: Array.isArray(p.slides) ? p.slides.filter((s) => s && s.imageId).map((s) => slide(s.imageId, s.crop)) : [],
    reel: { ...base.reel, ...(p.reel || {}) },
    caption: { ...base.caption, ...(p.caption || {}) },
    schedule: { ...base.schedule, ...(p.schedule || {}) },
    publish: { ...base.publish, ...(p.publish || {}) },
    metrics: { ...base.metrics, ...(p.metrics || {}) },
    design: p.design ? { ...emptyDesign(), ...p.design, copy: { ...emptyDesign().copy, ...(p.design.copy || {}) } } : null,
  }
}

// ---- Posts --------------------------------------------------------------------------

// Grid position 0 is the top-left tile: the newest post. Post numbers count up from the
// oldest, so the post at index i is P(N - i).
export const postNumber = (posts, index) => posts.length - index
export const postLabelAt = (posts, index) => `P${posts.length - index}`

export function postLabel(posts, postId) {
  const i = posts.findIndex((p) => p.id === postId)
  return i < 0 ? '' : postLabelAt(posts, i)
}

export function postStage(post) {
  if (post.metrics?.latest) return 'measured'
  if (post.publish?.igMediaId) return 'published'
  if (post.approved && post.schedule?.at) return 'scheduled'
  if (post.approved) return 'approved'
  if (post.caption?.text?.trim()) return 'captioned'
  if (post.design?.exportImageId) return 'designed'
  if (post.slides?.length) return 'planned'
  return 'idea'
}

export const STAGE_LABELS = {
  idea: 'Idea',
  planned: 'Planned',
  designed: 'Designed',
  captioned: 'Captioned',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  measured: 'Measured',
}

export const isPublished = (post) => !!post.publish?.igMediaId

// Image ids a post will actually publish, with the exported design replacing slide 1.
export function publishImageIds(post) {
  const ids = post.slides.map((s) => s.imageId)
  if (post.design?.exportImageId) {
    if (ids.length) ids[0] = post.design.exportImageId
    else ids.push(post.design.exportImageId)
  }
  return ids
}

export const coverImageId = (post) => post.design?.exportImageId || post.slides[0]?.imageId || null

// Which posts use each image: imageId -> [{ postId, index, label, slide, posted }].
export function usageMap(posts) {
  const map = new Map()
  posts.forEach((p, i) => {
    p.slides.forEach((s, j) => {
      if (!s.imageId) return
      const list = map.get(s.imageId) || []
      list.push({ postId: p.id, index: i, label: postLabelAt(posts, i), slide: j, posted: isPublished(p) })
      map.set(s.imageId, list)
    })
  })
  return map
}

// Where an image sits for the director: used, waiting, or out of play.
export function imageShelf(img, usage) {
  if (img.role === 'reference') return 'reference'
  if (img.role === 'design') return 'design'
  const uses = usage.get(img.id)
  if (uses?.some((u) => u.posted)) return 'posted'
  if (uses?.length) return 'planned'
  if (img.cull === 'reject') return 'rejected'
  if (img.setAside) return 'aside'
  return 'unused'
}

export const SHELF_LABELS = {
  unused: 'Unused',
  planned: 'In plan',
  posted: 'Posted',
  aside: 'Set aside',
  rejected: 'Rejected',
  reference: 'References',
  design: 'Designs',
}

// Photos that can go into a post (not references or exported designs).
export const isPhoto = (img) => img.role !== 'reference' && img.role !== 'design'

export function isWhiteBackground(img) {
  const p = img.profile
  if (!p) return false
  if (p.background === 'white-studio') return true
  const s = String(p.summary || '').toLowerCase()
  return s.includes('white') && /background|studio|backdrop|surface/.test(s)
}

// ---- Captions ---------------------------------------------------------------------------

export const hashtagsIn = (text) => String(text || '').match(/#[\p{L}\p{N}_]+/gu) || []

// Hashtags from the hashtag field, once each, in the order written.
export function hashtagList(text) {
  const seen = new Set()
  return hashtagsIn(text).filter((t) => {
    const k = t.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// Instagram allows at most 5 hashtags, counting those written inside the caption.
export function hashtagCount(caption) {
  const inText = hashtagsIn(caption.text).length
  return inText + hashtagList(caption.hashtags).length
}

export function captionForPublish(caption) {
  const text = String(caption.text || '').trim()
  const tags = hashtagList(caption.hashtags).join(' ')
  return caption.hashtagMode === 'caption' && tags ? `${text}\n\n${tags}` : text
}

export function firstCommentForPublish(caption) {
  const tags = hashtagList(caption.hashtags).join(' ')
  return [String(caption.firstComment || '').trim(), caption.hashtagMode === 'comment' ? tags : ''].filter(Boolean).join('\n\n')
}

// ---- Crops ---------------------------------------------------------------------------------

// CSS that shows an image cover-fitted into a frame of `frameAspect` (width / height), with
// the crop's focal point and zoom. Matches cropRect() below pixel for pixel.
export function cropBackground(url, imgW, imgH, frameAspect, crop = DEFAULT_CROP) {
  const a = imgW && imgH ? imgW / imgH : 1
  const f = frameAspect || 1
  const zoom = Math.max(1, crop?.zoom || 1)
  const sx = Math.max(1, a / f) * zoom * 100
  const sy = Math.max(f / a, 1) * zoom * 100
  return {
    backgroundImage: url ? `url("${url}")` : undefined,
    backgroundSize: `${sx}% ${sy}%`,
    backgroundPosition: `${(crop?.x ?? 0.5) * 100}% ${(crop?.y ?? 0.5) * 100}%`,
    backgroundRepeat: 'no-repeat',
  }
}

// Where to draw an image of w x h into a W x H canvas for the same crop.
export function cropRect(w, h, W, H, crop = DEFAULT_CROP) {
  const s = Math.max(W / w, H / h) * Math.max(1, crop?.zoom || 1)
  const dw = w * s
  const dh = h * s
  return { dx: -(dw - W) * (crop?.x ?? 0.5), dy: -(dh - H) * (crop?.y ?? 0.5), dw, dh }
}

export function orientationOf(w, h) {
  if (!w || !h) return 'portrait'
  const r = w / h
  if (r > 1.1) return 'landscape'
  if (r < 0.9) return 'portrait'
  return 'square'
}

// ---- Lookups -------------------------------------------------------------------------------

export const byId = (list) => new Map(list.map((x) => [x.id, x]))

export function kitByName(themes, name) {
  const n = String(name || '').trim().toLowerCase()
  return n ? themes.find((k) => k.name.trim().toLowerCase() === n) || null : null
}
