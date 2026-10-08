// Promote: Instagram ads through the Meta Marketing API. Everything is created PAUSED so
// it can be checked in Ads Manager before any money is spent. The campaign brief is the
// manual route: the same settings laid out field by field for Ads Manager.
import { graph, MetaError } from './meta.js'
import { askJson } from './api.js'
import { visionDataUrl, getFullBlob } from '../data/media.js'
import { decodeImage, cropToBlob, blobToDataUrl } from './image.js'
import { AD_SYSTEM, OBJECTIVES, OPT_GOAL, PLACEMENTS, FUNNEL, CTA_LABELS, CTA_OPTIONS } from './prompts.js'
import { DEFAULT_CROP } from '../data/model.js'
import { downloadBlob, wait } from './download.js'

export const AD_LIMITS = { primaryText: 125, headline: 40, description: 30 }

export const placementInfo = (id) => PLACEMENTS.find((p) => p.id === id) || PLACEMENTS[0]
export const objectiveInfo = (id) => OBJECTIVES.find((o) => o.id === id) || OBJECTIVES[0]
export const funnelInfo = (id) => FUNNEL.find((f) => f.id === id) || FUNNEL[0]
export const ctaLabel = (id) => CTA_LABELS[id] || id || ''

// Character count against a Meta limit. tone: ok | near (over 88%) | over
export function charMeta(text, limit) {
  const len = String(text || '').length
  const tone = len > limit ? 'over' : len > limit * 0.88 ? 'near' : 'ok'
  return { len, limit, over: tone === 'over', tone }
}

export function variantCopyText(v, index) {
  return [
    index == null ? null : `AD ${index + 1}: ${v.angle || 'Variant'}`,
    `PRIMARY TEXT:\n${v.primaryText}`,
    `HEADLINE:\n${v.headline}`,
    `DESCRIPTION:\n${v.description}`,
    `CTA: ${ctaLabel(v.cta)}`,
  ].filter(Boolean).join('\n\n')
}

const shortList = (items, n, empty) =>
  !items?.length ? empty : items.slice(0, n).join(', ') + (items.length > n ? ` +${items.length - n}` : '')

export const genderLabel = (genders) => (!genders?.length ? 'All' : genders[0] === 1 ? 'Men' : 'Women')

export function targetingSummary(t, budget) {
  return [
    genderLabel(t.genders),
    `${t.ageMin}–${t.ageMax}`,
    shortList(t.cities, 3, 'India'),
    shortList(t.interests, 2, 'No interests'),
    `₹${Number(budget || 0).toLocaleString('en-IN')}/day`,
  ].join(' · ')
}

export function websiteLink(settings) {
  const site = String(settings?.website || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return site ? `https://${site}` : ''
}

export const normalizeAccount = (id) => {
  const raw = String(id || '').trim().replace(/^act_/, '')
  return raw ? `act_${raw}` : ''
}

export function adsManagerUrl(adAccountId, campaignId) {
  const act = normalizeAccount(adAccountId).replace(/^act_/, '')
  const base = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(act)}`
  return campaignId ? `${base}&selected_campaign_ids=${encodeURIComponent(campaignId)}` : base
}

// ---- Copy ---------------------------------------------------------------------------

const CTA_SET = new Set(CTA_OPTIONS)

function cleanVariant(v, fallbackCta) {
  return {
    angle: String(v?.angle || 'Variant').trim(),
    hook: String(v?.hook || '').trim(),
    primaryText: String(v?.primaryText || '').trim(),
    headline: String(v?.headline || '').trim(),
    description: String(v?.description || '').trim(),
    cta: CTA_SET.has(v?.cta) ? v.cta : fallbackCta || 'LEARN_MORE',
  }
}

export async function generateAdVariants({ imageId, draft, context, audience, signal }) {
  if (!imageId) throw new Error('Select an image first')
  const p = placementInfo(draft.placement)
  const image = await visionDataUrl(imageId, 1024)
  const res = await askJson({
    tier: 'opus',
    system: AD_SYSTEM(context, draft.objective, p.label, draft.funnel, draft.advPlus, audience || ''),
    prompt: `Look at this image. It is the visual creative for an Instagram ${p.label} ad. Generate 3 copy variants for it.`,
    images: [image],
    maxTokens: 6000,
    effort: 'medium',
    thinking: 'adaptive',
    signal,
  })
  const variants = (Array.isArray(res?.variants) ? res.variants : []).slice(0, 3).map((v) => cleanVariant(v, draft.cta))
  if (!variants.length) throw new Error('Claude returned no variants. Try again.')
  return variants
}

// ---- Images -------------------------------------------------------------------------

export async function renderAdImage(imageId, w, h, crop = DEFAULT_CROP) {
  const blob = await getFullBlob(imageId)
  if (!blob) throw new Error('This image is missing from storage — re-import it in the Library.')
  const decoded = await decodeImage(blob)
  try {
    return await cropToBlob(decoded, crop || DEFAULT_CROP, w, h, 0.93)
  } finally {
    decoded.close()
  }
}

export const adImageName = (placement) => {
  const p = placementInfo(placement)
  return `ad-${p.id}-${p.w}x${p.h}.jpg`
}

export async function downloadAdImage(imageId, placement, crop) {
  const p = placementInfo(placement)
  downloadBlob(await renderAdImage(imageId, p.w, p.h, crop), adImageName(placement))
  return `Downloaded ${p.w}×${p.h}`
}

const ALL_FORMATS = [['feed', 1080, 1350], ['stories', 1080, 1920], ['reels', 1080, 1920]]

// Feed 4:5 plus Stories and Reels 9:16, for Advantage+ placements.
export async function downloadAllFormats(imageId, crop) {
  const rendered = new Map()
  for (let i = 0; i < ALL_FORMATS.length; i++) {
    const [label, w, h] = ALL_FORMATS[i]
    const key = `${w}x${h}`
    if (!rendered.has(key)) rendered.set(key, await renderAdImage(imageId, w, h, crop))
    downloadBlob(rendered.get(key), `ad-${label}-${w}x${h}.jpg`)
    if (i < ALL_FORMATS.length - 1) await wait(700)
  }
}

// ---- Targeting ----------------------------------------------------------------------

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

// City and interest names become Meta ids at push time. Matches are cached in
// adDraft.resolved so the next push skips the lookups.
export async function resolveTargeting(draft, { signal } = {}) {
  const resolved = { ...(draft.resolved || {}) }
  const t = draft.targeting
  const cities = []
  const interests = []
  const unresolved = []
  for (const name of t.cities || []) {
    const key = `city:${name}`
    if (!resolved[key]) {
      const d = await graph('GET', '/search', { type: 'adgeolocation', location_types: ['city'], q: name, country_code: t.country || 'IN', limit: 5 }, { signal })
      const list = Array.isArray(d.data) ? d.data : []
      const best = list.find((c) => sameName(c.name, name)) || list[0]
      if (best?.key) resolved[key] = { key: String(best.key), name: best.name, region: best.region || '' }
    }
    if (resolved[key]) cities.push(resolved[key])
    else unresolved.push(name)
  }
  if (!draft.advPlus) {
    for (const name of t.interests || []) {
      const key = `interest:${name}`
      if (!resolved[key]) {
        const d = await graph('GET', '/search', { type: 'adinterest', q: name, limit: 5 }, { signal })
        const list = Array.isArray(d.data) ? d.data : []
        const best = list.find((x) => sameName(x.name, name)) || list[0]
        if (best?.id) resolved[key] = { id: String(best.id), name: best.name }
      }
      if (resolved[key]) interests.push(resolved[key])
      else unresolved.push(name)
    }
  }
  return { resolved, cities, interests, unresolved }
}

const clampAge = (n, fallback) => Math.max(18, Math.min(65, Number(n) || fallback))

// With Advantage+ audience on, location stays a hard limit; age only allows a minimum
// up to 25 and must run to 65, and interests are left for Meta to find.
export function buildTargeting(draft, { cities = [], interests = [] } = {}) {
  const t = draft.targeting
  const ageMin = clampAge(t.ageMin, 25)
  const ageMax = Math.max(ageMin, clampAge(t.ageMax, 55))
  const out = {
    geo_locations: cities.length
      ? { cities: cities.map((c) => ({ key: c.key, radius: 25, distance_unit: 'kilometer' })) }
      : { countries: [t.country || 'IN'] },
    age_min: draft.advPlus ? Math.min(ageMin, 25) : ageMin,
    age_max: draft.advPlus ? 65 : ageMax,
    targeting_automation: { advantage_audience: draft.advPlus ? 1 : 0 },
    publisher_platforms: ['instagram'],
    instagram_positions: draft.placement === 'story' ? ['story'] : draft.placement === 'reels' ? ['reels'] : ['stream'],
  }
  if (t.genders?.length) out.genders = t.genders
  if (!draft.advPlus && interests.length) out.flexible_spec = [{ interests: interests.map((i) => ({ id: i.id, name: i.name })) }]
  return out
}

// ---- Push ---------------------------------------------------------------------------

async function stage(label, fn) {
  try {
    return await fn()
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new MetaError(`${label}: ${err.message}`, { code: err.code, subcode: err.subcode, kind: err.kind || 'api', status: err.status, title: err.title })
  }
}

// Checks everything a push needs. Returns an error message, or '' when ready.
export function pushProblem({ draft, settings, imageId, mediaId, variants }) {
  if (!normalizeAccount(settings.adAccountId)) return 'Add your ad account ID in Settings'
  if (!String(settings.pageId || '').trim()) return 'Add your Facebook Page ID in Settings (Find my accounts fills it in).'
  if (!String(settings.igAccountId || '').trim()) return 'Add your Instagram account ID in Settings.'
  if (draft.objective === 'OUTCOME_TRAFFIC' && !websiteLink(settings)) return 'Add your website in Settings — Traffic ads need a link.'
  if (draft.mode === 'boost') return mediaId ? '' : 'Choose a published post to boost'
  if (!imageId) return 'Select an image first'
  if (!variants?.length) return 'Generate copy variants first'
  if (!websiteLink(settings)) return 'Add your website in Settings first.'
  if (!(Number(draft.budgetDaily) > 0)) return 'Set a daily budget'
  return ''
}

const istStart = (date) => (date ? `${date}T00:00:00+05:30` : undefined)
const istEnd = (date) => (date ? `${date}T23:59:00+05:30` : undefined)

// Creates campaign -> ad set -> (image) -> one creative and ad per variant, all PAUSED.
// Several variants share one ad set so Meta can compare them. On failure, whatever was
// created is deleted again (newest first). Returns ids, the Ads Manager link and the
// updated name lookups for the draft.
export async function pushCampaign({ draft, variants = [], imageId, mediaId, crop, settings, onStep, signal }) {
  const problem = pushProblem({ draft, settings, imageId, mediaId, variants })
  if (problem) throw new MetaError(problem, { kind: 'config' })
  const step = (s) => onStep?.(s)
  const act = normalizeAccount(settings.adAccountId)
  const pageId = String(settings.pageId).trim()
  const igId = String(settings.igAccountId).trim()
  const link = websiteLink(settings)
  const obj = objectiveInfo(draft.objective)
  const p = placementInfo(draft.placement)
  const f = funnelInfo(draft.funnel)
  const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const boost = draft.mode === 'boost'

  step('Finding cities and interests…')
  const lookup = await stage('Targeting', () => resolveTargeting(draft, { signal }))
  const created = []
  const notes = []
  if (lookup.unresolved.length) notes.push(`Not found on Meta, left out: ${lookup.unresolved.join(', ')}.`)
  if (draft.advPlus) notes.push(`Advantage+ is on, so age ${draft.targeting.ageMin}–${draft.targeting.ageMax} is not a hard limit. Add it as a suggestion in Ads Manager if you want.`)

  try {
    step('Creating the campaign…')
    const campaign = await stage('Campaign', () => graph('POST', `/${act}/campaigns`, {
      name: `KSS · ${obj.label} · ${date}`,
      objective: obj.id,
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    }, { signal }))
    created.push(campaign.id)

    step('Creating the ad set…')
    const adsetParams = {
      name: `${p.label} · ${f.label}`,
      campaign_id: campaign.id,
      daily_budget: Math.round(Number(draft.budgetDaily) * 100),
      billing_event: 'IMPRESSIONS',
      optimization_goal: OPT_GOAL[obj.id] || 'REACH',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: buildTargeting(draft, lookup),
      status: 'PAUSED',
    }
    if (obj.id === 'OUTCOME_TRAFFIC') adsetParams.destination_type = 'WEBSITE'
    if (obj.id === 'OUTCOME_ENGAGEMENT') adsetParams.destination_type = 'ON_POST'
    if (!draft.ongoing) {
      adsetParams.start_time = istStart(draft.startDate)
      adsetParams.end_time = istEnd(draft.endDate)
    }
    const adset = await stage('Ad Set', () => graph('POST', `/${act}/adsets`, adsetParams, { signal }))
    created.push(adset.id)

    const ads = []
    if (boost) {
      step('Creating the ad…')
      const creativeParams = {
        name: `KSS Boost · ${date}`,
        object_id: pageId,
        instagram_user_id: igId,
        source_instagram_media_id: mediaId,
      }
      if (obj.id === 'OUTCOME_TRAFFIC') creativeParams.call_to_action = { type: draft.cta || 'LEARN_MORE', value: { link } }
      const creative = await stage('Creative', () => graph('POST', `/${act}/adcreatives`, creativeParams, { signal }))
      created.push(creative.id)
      const ad = await stage('Ad', () => graph('POST', `/${act}/ads`, {
        name: `KSS Boost · ${date}`, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED',
      }, { signal }))
      created.push(ad.id)
      ads.push({ creativeId: creative.id, adId: ad.id, angle: 'Boost' })
    } else {
      step('Uploading the image…')
      const blob = await renderAdImage(imageId, p.w, p.h, crop)
      const bytes = (await blobToDataUrl(blob)).replace(/^data:[^,]*,/, '')
      const upload = await stage('Image', () => graph('POST', `/${act}/adimages`, { bytes }, { signal }))
      const hash = Object.values(upload.images || {})[0]?.hash
      if (!hash) throw new MetaError('Image: No image hash from Meta')
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i]
        const angle = v.angle || 'Variant'
        step(variants.length > 1 ? `Creating ad ${i + 1} of ${variants.length}…` : 'Creating the ad…')
        const creative = await stage('Creative', () => graph('POST', `/${act}/adcreatives`, {
          name: `KSS Creative · ${angle} · ${date}`,
          object_story_spec: {
            page_id: pageId,
            instagram_user_id: igId,
            link_data: {
              image_hash: hash,
              link,
              message: v.primaryText,
              name: v.headline,
              description: v.description,
              call_to_action: { type: v.cta || draft.cta || 'LEARN_MORE', value: { link } },
            },
          },
        }, { signal }))
        created.push(creative.id)
        const ad = await stage('Ad', () => graph('POST', `/${act}/ads`, {
          name: `KSS Ad · ${angle} · ${date}`, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED',
        }, { signal }))
        created.push(ad.id)
        ads.push({ creativeId: creative.id, adId: ad.id, angle })
      }
    }
    return {
      campaignId: campaign.id,
      adsetId: adset.id,
      ads,
      url: adsManagerUrl(act, campaign.id),
      resolved: lookup.resolved,
      notes,
    }
  } catch (err) {
    if (created.length) {
      step('Cleaning up…')
      let left = 0
      for (const id of [...created].reverse()) {
        await graph('DELETE', `/${id}`).catch(() => { left++ })
      }
      err.message += left
        ? ' — some parts may still be in Ads Manager as paused drafts.'
        : ' — nothing was left behind in Ads Manager.'
    }
    throw err
  }
}

// ---- Manual route -------------------------------------------------------------------

// The draft laid out in the order Ads Manager asks for it.
// Rows are [label, value, muted?]; sections with `copy` get a "Copy all" button.
export function campaignBrief(draft, settings) {
  const obj = objectiveInfo(draft.objective)
  const p = placementInfo(draft.placement)
  const f = funnelInfo(draft.funnel)
  const t = draft.targeting
  const month = new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  const link = websiteLink(settings)
  const variants = draft.variants || []
  const image = adImageName(draft.placement)
  const placementName = { feed: 'Feed', story: 'Stories', reels: 'Reels', square: 'Feed' }[p.id] || 'Feed'

  const adSetRows = [
    ['Ad Set name', `${p.label} · ${t.cities.length ? t.cities.slice(0, 3).join(', ') : 'India'} · ${t.ageMin}–${t.ageMax}`],
    ['Daily budget', `₹${Number(draft.budgetDaily || 0).toLocaleString('en-IN')}`],
    ['Schedule', draft.ongoing ? 'Set start date, no end date' : `Start: ${draft.startDate || 'not set'}${draft.endDate ? ` · End: ${draft.endDate}` : ''}`],
    ['Audience mode', draft.advPlus
      ? 'Advantage+ Audience — toggle it ON at the top of the Audience section. Set suggested demographic only, leave interests empty.'
      : 'Manual targeting'],
    ['Locations', t.cities.length ? t.cities.join(', ') : 'India (country-level)'],
    ['Age', `${t.ageMin} – ${t.ageMax}${draft.advPlus ? ' (as a suggestion)' : ''}`],
    ['Gender', !t.genders?.length ? 'All genders' : t.genders[0] === 1 ? 'Men only' : 'Women only'],
  ]
  if (!draft.advPlus && t.interests.length) {
    adSetRows.push(['Detailed targeting', `${t.interests.join(', ')}\n(search each one in the "Add interests" field)`])
  }
  adSetRows.push(['Placements', draft.advPlus
    ? 'Advantage+ placements — leave on Automatic. Meta tests Feed, Stories, Reels.'
    : `Manual → Instagram only → ${placementName}`])
  if (draft.advPlus) adSetRows.push(['Advantage+ Creative', 'Enable at the Ad level — Meta auto-generates creative variants'])

  const sections = [
    {
      title: 'Step 1 — Campaign (one time)',
      rows: [
        ['Campaign name', `KSS · ${obj.label} · ${month}`],
        ['Objective', `${obj.label} — select this in the "Campaign objective" screen`],
        ['Special categories', 'None — leave all unchecked'],
        ['Campaign budget', 'Off — set budget at Ad Set level'],
      ],
    },
    { title: 'Step 2 — Ad Set (targeting + budget)', rows: adSetRows },
    ...variants.map((v, i) => ({
      title: `Step ${3 + i} — Ad ${i + 1} of ${variants.length}: ${v.angle || 'Variant'}`,
      copy: variantCopyText(v, i),
      copyToast: `Ad ${i + 1} copied`,
      rows: [
        ['Ad name', `Ad ${i + 1} · ${v.angle || 'Variant'}`],
        ['Image', `Upload "${image}" (Download image above) — the same image for every ad`, true],
        ['Primary text', v.primaryText],
        ['Headline', v.headline],
        ['Description', v.description],
        ['Call to action', ctaLabel(v.cta)],
        ['Website URL', link || 'Add your website in Settings'],
      ],
    })),
  ]
  const n = variants.length
  const notes = n > 1
    ? [
        `Create all ${n} ads inside the same Ad Set — Meta will automatically optimise delivery between them (Dynamic Creative Testing).`,
        'Leave all ads in Review state — do not publish until you have reviewed the preview on mobile.',
        `After review, set Status to Active on all ${n} together.`,
      ]
    : ['Leave the ad in Review state — do not publish until you have reviewed the preview on mobile.']
  return {
    title: 'Campaign Brief',
    subtitle: `${obj.label} · ${p.label} · ${f.label} · ${targetingSummary(t, draft.budgetDaily)}`,
    image,
    sections,
    notes,
  }
}
