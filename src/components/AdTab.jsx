import { useState, useCallback, useRef } from 'react'
import { useStore, claudeVision, M_OPUS } from '../store.jsx'
import Tip from './Tip.jsx'

// ── CONSTANTS ─────────────────────────────────────────────

const OBJECTIVES = [
  { id: 'OUTCOME_AWARENESS',       label: 'Awareness',   desc: 'Max reach & recall' },
  { id: 'OUTCOME_TRAFFIC',         label: 'Traffic',     desc: 'Drive clicks to site' },
  { id: 'OUTCOME_ENGAGEMENT',      label: 'Engagement',  desc: 'Likes, comments, shares' },
  { id: 'OUTCOME_LEADS',           label: 'Leads',       desc: 'Collect contact info' },
  { id: 'OUTCOME_APP_PROMOTION',   label: 'App',         desc: 'App installs & activity' },
  { id: 'OUTCOME_SALES',           label: 'Sales',       desc: 'Purchases & conversions' },
]

const PLACEMENTS = [
  { id: 'feed',   label: 'Feed 4:5',    w: 1080, h: 1350 },
  { id: 'story',  label: 'Story 9:16',  w: 1080, h: 1920 },
  { id: 'reels',  label: 'Reels 9:16',  w: 1080, h: 1920 },
  { id: 'square', label: 'Square 1:1',  w: 1080, h: 1080 },
]

const FUNNEL = [
  { id: 'tofu', label: 'TOFU', desc: 'Cold — introduce the brand' },
  { id: 'mofu', label: 'MOFU', desc: 'Warm — building consideration' },
  { id: 'bofu', label: 'BOFU', desc: 'Hot — retargeting, ready to act' },
]

const CTA_OPTIONS = [
  'LEARN_MORE', 'SHOP_NOW', 'BOOK_NOW', 'SIGN_UP',
  'GET_QUOTE', 'CONTACT_US', 'SUBSCRIBE', 'APPLY_NOW', 'ORDER_NOW',
]

const CTA_LABELS = {
  LEARN_MORE: 'Learn More', SHOP_NOW: 'Shop Now', BOOK_NOW: 'Book Now',
  SIGN_UP: 'Sign Up', GET_QUOTE: 'Get Quote', CONTACT_US: 'Contact Us',
  SUBSCRIBE: 'Subscribe', APPLY_NOW: 'Apply Now', ORDER_NOW: 'Order Now',
}

// ── SYSTEM PROMPT ─────────────────────────────────────────

const AD_SYSTEM = (context, objective, placement, funnel, advPlus = false) => {
  const objStrategy = {
    OUTCOME_AWARENESS:     'Write for memorability, not clicks. Brand voice and visual recall matter most. No hard sell.',
    OUTCOME_TRAFFIC:       'Lead with value or curiosity. Make them want to know more. The CTA should feel inevitable.',
    OUTCOME_ENGAGEMENT:    'Provoke a reaction — a question, a bold claim, a relatable truth that invites response.',
    OUTCOME_LEADS:         'Offer something specific. Address their problem directly. Reduce friction.',
    OUTCOME_APP_PROMOTION: 'Feature-led or benefit-led. Fast hook, clear CTA, remove all hesitation.',
    OUTCOME_SALES:         'Create desire and urgency. What changes for them after this? Outcome-focused.',
  }
  const funnelStrategy = {
    tofu: 'COLD audience — never heard of this brand. Educate and intrigue. No jargon. Build desire first.',
    mofu: 'WARM audience — aware but not converted. Deepen the story, address objections, show proof.',
    bofu: 'HOT audience — retargeting. They know you. Cut to the point. Offer, urgency, direct CTA.',
  }

  return `You are a Meta Ads specialist writing Instagram ad copy for a luxury commercial photography studio.

${context ? `BRAND BRIEF:\n${context.slice(0, 600)}` : 'Luxury commercial photography studio.'}

AD PARAMETERS:
Objective: ${objective} — ${objStrategy[objective] || ''}
Placement: ${placement}
Audience: ${funnelStrategy[funnel] || ''}

META CHARACTER LIMITS — count every character, these are hard constraints:
- Hook: 10–15 words. The single line that stops the scroll. Opens the primary text.
- Primary Text: ≤125 chars for full preview. Beyond this Meta truncates with "…more".
- Headline: MAX 40 chars. Benefit-led or intrigue-led.
- Description: MAX 30 chars. Supporting claim or CTA reinforcement.

LUXURY COPY RULES:
- Luxury does not beg. No exclamation marks unless objective is Sales + BOFU.
- Hook creates desire or curiosity — never describes features.
- Banned words: stunning, amazing, perfect, best, incredible, take your brand to the next level.
- Brand voice from the brief must come through in rhythm and word choice.
- 3 variants must have genuinely different angles — not just synonym swaps.
${advPlus ? `
ADVANTAGE+ MODE — AUDIENCE SIGNAL COPY:
Meta's Advantage+ AI reads your copy text to determine who to show this ad to — there is no manual interest targeting. You must embed the intended client type naturally in the hook and primary text so the algorithm can self-target. Do not address the audience generically.
Examples of strong audience signals:
- "For interior designers who want their projects remembered..."
- "For founders who understand that the product is only half the story..."
- "For F&B brands where the visual is the first bite..."
The signal must feel native to the brand voice — not a demographic tag. Each of the 3 variants should signal a different client type or intent so Advantage+ can test which segment responds.` : ''}

Generate exactly 3 variants. Return ONLY valid JSON, no markdown:
{
  "variants": [
    {
      "angle": "brief label for this variant's strategy (e.g. 'desire-led', 'social proof', 'problem-agitate')",
      "hook": "scroll-stopping first line (10–15 words)",
      "primaryText": "full primary text — hook as first line, ≤125 chars total",
      "headline": "max 40 chars",
      "description": "max 30 chars",
      "cta": "one of: LEARN_MORE SHOP_NOW BOOK_NOW SIGN_UP GET_QUOTE CONTACT_US SUBSCRIBE APPLY_NOW ORDER_NOW"
    }
  ]
}`
}

// ── TARGETING DATA ────────────────────────────────────────
// Interest names — IDs resolved via /search?type=adinterest when token available
const INTEREST_GROUPS = [
  { group: 'Photography & Creative', items: ['Photography', 'Commercial photography', 'Fashion photography', 'Product photography', 'Advertising'] },
  { group: 'Design & Space',         items: ['Interior design', 'Architecture', 'Interior architecture', 'Home decoration', 'Furniture'] },
  { group: 'Luxury & Lifestyle',     items: ['Luxury goods', 'Fashion', 'Fine dining', 'Jewellery', 'Travel', 'Watches'] },
  { group: 'Business',               items: ['Small business', 'Entrepreneurship', 'Marketing', 'Brand management', 'Retail'] },
  { group: 'Real Estate',            items: ['Real estate', 'Property management', 'Hotels', 'Hospitality'] },
]

const INDIA_CITIES = ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune', 'Kolkata', 'Ahmedabad', 'Gurgaon', 'Noida', 'Jaipur', 'Chandigarh', 'Surat', 'Kochi']

const OPT_GOAL = {
  OUTCOME_AWARENESS:     'REACH',
  OUTCOME_TRAFFIC:       'LINK_CLICKS',
  OUTCOME_ENGAGEMENT:    'POST_ENGAGEMENT',
  OUTCOME_LEADS:         'LEAD_GENERATION',
  OUTCOME_APP_PROMOTION: 'APP_INSTALLS',
  OUTCOME_SALES:         'OFFSITE_CONVERSIONS',
}

// ── CHARACTER COUNT HELPER ────────────────────────────────

function charMeta(text, limit) {
  const len = (text || '').length
  const over = len > limit
  const warn = len > limit * 0.88
  const color = over ? 'rgba(220,70,70,.9)' : warn ? 'rgba(220,160,0,.85)' : 'var(--text2)'
  return { len, over, color }
}

// ── COMPONENT ─────────────────────────────────────────────

export default function AdTab({ showToast }) {
  const { state } = useStore()

  const [selectedImgId, setSelectedImgId]     = useState(null)
  const [adContext, setAdContext]             = useState(() => localStorage.getItem('kss_ad_context') || '')
  const [objective, setObjective]             = useState('OUTCOME_AWARENESS')
  const [placement, setPlacement]             = useState('feed')
  const [funnel, setFunnel]                   = useState('tofu')
  const [variants, setVariants]               = useState([])
  const [generating, setGenerating]           = useState(false)
  const [selectedIdx, setSelectedIdx]         = useState(0)
  const [publishing, setPublishing]           = useState(false)
  const [showBrief, setShowBrief]             = useState(false)
  const [advPlus, setAdvPlus]                 = useState(false)
  const [targetingOpen, setTargetingOpen]     = useState(false)
  const [targeting, setTargeting]             = useState({
    ageMin: 25, ageMax: 55,
    genders: [],          // [] = all, [1] = men, [2] = women
    country: 'IN',
    cities: [],           // city names — resolve to Meta keys when token available
    interests: [],        // interest names — resolve to Meta IDs when token available
    budgetDaily: 1000,    // INR
    ongoing: true,
    startDate: new Date().toISOString().split('T')[0],
  })
  const filmRef = useRef(null)

  const visibleImages = state.images.filter(img => !(state.excludedNames || []).includes(img.name))
  const selectedImg   = visibleImages.find(i => i.id === selectedImgId) || visibleImages[0] || null
  const activePlacement = PLACEMENTS.find(p => p.id === placement)

  // ── Generate ──────────────────────────────────────────

  const generate = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key)          { showToast('Add API key in Settings'); return }
    if (!selectedImg)  { showToast('Select an image first');  return }
    setGenerating(true)
    try {
      const system = AD_SYSTEM(adContext, objective, placement, funnel, advPlus)
      const prompt = `Look at this image. It is the visual creative for an Instagram ${placement} ad. Generate 3 copy variants for it.`
      const raw    = await claudeVision(key, system, prompt, selectedImg.dataUrl, M_OPUS, 1600)
      const match  = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        if (parsed.variants?.length) {
          setVariants(parsed.variants)
          setSelectedIdx(0)
          showToast('3 variants generated ✓')
        }
      }
    } catch(e) { showToast('Generation failed: ' + e.message) }
    finally { setGenerating(false) }
  }, [state, selectedImg, adContext, objective, placement, funnel, advPlus, showToast])

  // ── Copy to clipboard ─────────────────────────────────

  const copyVariant = (v) => {
    const text = [
      `PRIMARY TEXT:\n${v.primaryText}`,
      `HEADLINE:\n${v.headline}`,
      `DESCRIPTION:\n${v.description}`,
      `CTA: ${CTA_LABELS[v.cta] || v.cta}`,
    ].join('\n\n')
    navigator.clipboard.writeText(text).then(() => showToast('Copied ✓'))
  }

  // ── Download image at placement dimensions ────────────

  const downloadImage = useCallback(() => {
    if (!selectedImg || !activePlacement) return
    const { w, h } = activePlacement
    const img = new Image()
    img.onload = () => {
      const canvas   = document.createElement('canvas')
      canvas.width   = w
      canvas.height  = h
      const ctx      = canvas.getContext('2d')
      const scale    = Math.max(w / img.width, h / img.height)
      const sw       = img.width * scale
      const sh       = img.height * scale
      ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh)
      const a        = document.createElement('a')
      a.download     = `ad-${placement}-${w}x${h}-${Date.now()}.jpg`
      a.href         = canvas.toDataURL('image/jpeg', 0.93)
      a.click()
      showToast(`Downloaded ${w}×${h} ✓`)
    }
    img.src = selectedImg.dataUrl
  }, [selectedImg, activePlacement, placement, showToast])

  // ── Download all 3 images (staggered) ────────────────

  const downloadAll = useCallback(() => {
    if (!selectedImg || !activePlacement) return
    const { w, h } = activePlacement
    variants.forEach((_, i) => {
      setTimeout(() => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')
          const scale = Math.max(w / img.width, h / img.height)
          ctx.drawImage(img, (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale)
          const a = document.createElement('a')
          a.download = `ad-v${i + 1}-${placement}-${w}x${h}.jpg`
          a.href = canvas.toDataURL('image/jpeg', 0.93)
          a.click()
        }
        img.src = selectedImg.dataUrl
      }, i * 600)
    })
    showToast('Downloading 3 images…')
  }, [selectedImg, activePlacement, placement, variants, showToast])

  // ── Download image in all 3 Advantage+ formats ────────

  const downloadAllFormats = useCallback(() => {
    if (!selectedImg) return
    const formats = [
      { label: 'feed',   w: 1080, h: 1350 },
      { label: 'stories', w: 1080, h: 1920 },
      { label: 'reels',  w: 1080, h: 1920 },
    ]
    formats.forEach(({ label, w, h }, i) => {
      setTimeout(() => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')
          const scale = Math.max(w / img.width, h / img.height)
          ctx.drawImage(img, (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale)
          const a = document.createElement('a')
          a.download = `ad-${label}-${w}x${h}.jpg`
          a.href = canvas.toDataURL('image/jpeg', 0.93)
          a.click()
        }
        img.src = selectedImg.dataUrl
      }, i * 700)
    })
    showToast('Feed + Stories + Reels downloading…')
  }, [selectedImg, showToast])

  // ── Targeting helpers ─────────────────────────────────

  const targetingSummary = () => {
    const gender = targeting.genders.length === 1 ? (targeting.genders[0] === 1 ? 'Men' : 'Women') : 'All'
    const loc    = targeting.cities.length
      ? targeting.cities.slice(0, 3).join(', ') + (targeting.cities.length > 3 ? ` +${targeting.cities.length - 3}` : '')
      : 'India'
    const int    = targeting.interests.length
      ? targeting.interests.slice(0, 2).join(', ') + (targeting.interests.length > 2 ? ` +${targeting.interests.length - 2}` : '')
      : 'No interests'
    return `${gender} · ${targeting.ageMin}–${targeting.ageMax} · ${loc} · ${int} · ₹${targeting.budgetDaily.toLocaleString()}/day`
  }

  const buildTargetingSpec = useCallback(() => {
    const spec = {
      age_min: targeting.ageMin,
      age_max: targeting.ageMax,
      publisher_platforms: ['instagram'],
      geo_locations: { countries: [targeting.country || 'IN'] },
    }
    if (targeting.genders.length) spec.genders = targeting.genders
    // Interest IDs are resolved via /search?type=adinterest once Meta token is available.
    // Interests stored as names for now — will be wired to IDs post-verification.
    return spec
  }, [targeting])

  // ── Full campaign push (Campaign → Ad Set → Creative → Ad) ──

  const pushCampaign = useCallback(async (variant) => {
    const token   = state.settings.metaToken
    const acctRaw = state.settings.adAccountId
    const igId    = state.settings.igAccountId
    if (!token)   { showToast('Add Meta token in Settings');    return }
    if (!acctRaw) { showToast('Add Ad Account ID in Settings'); return }
    if (!selectedImg) { showToast('Select an image first');     return }
    if (!variant) { showToast('Generate copy variants first');  return }
    const acct = acctRaw.replace(/^act_/, '')
    setPublishing(true)
    try {
      // 1 — Campaign
      const campRes = await fetch(`https://graph.facebook.com/v20.0/act_${acct}/campaigns`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `KSS · ${OBJECTIVES.find(o => o.id === objective)?.label} · ${new Date().toLocaleDateString()}`,
          objective, status: 'PAUSED', special_ad_categories: [], access_token: token,
        }),
      })
      const camp = await campRes.json()
      if (camp.error) throw new Error(`Campaign: ${camp.error.message}`)

      // 2 — Ad Set (with targeting + budget)
      const adSetBody = {
        name: `${PLACEMENTS.find(p => p.id === placement)?.label} · ${FUNNEL.find(f => f.id === funnel)?.label}`,
        campaign_id: camp.id,
        billing_event: 'IMPRESSIONS',
        optimization_goal: OPT_GOAL[objective] || 'REACH',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        daily_budget: targeting.budgetDaily * 100,
        targeting: buildTargetingSpec(),
        status: 'PAUSED',
        access_token: token,
      }
      if (!targeting.ongoing && targeting.startDate) adSetBody.start_time = targeting.startDate
      if (igId) adSetBody.instagram_actor_id = igId
      const adSetRes = await fetch(`https://graph.facebook.com/v20.0/act_${acct}/adsets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adSetBody),
      })
      const adSet = await adSetRes.json()
      if (adSet.error) throw new Error(`Ad Set: ${adSet.error.message}`)

      // 3 — Upload image
      const b64   = selectedImg.dataUrl.split(',')[1]
      const upRes = await fetch(`https://graph.facebook.com/v20.0/act_${acct}/adimages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bytes: b64, access_token: token }),
      })
      const upData    = await upRes.json()
      if (!upRes.ok)  throw new Error(upData.error?.message || 'Image upload failed')
      const imageHash = Object.values(upData.images || {})[0]?.hash
      if (!imageHash) throw new Error('No image hash from Meta')

      // 4 — Ad Creative
      const crRes = await fetch(`https://graph.facebook.com/v20.0/act_${acct}/adcreatives`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `KSS Creative · ${variant.angle || 'Variant'} · ${new Date().toLocaleDateString()}`,
          object_story_spec: {
            ...(igId ? { instagram_actor_id: igId } : {}),
            link_data: {
              image_hash: imageHash,
              link: 'https://www.kshetejsareen.com',
              message: variant.primaryText,
              name: variant.headline,
              description: variant.description,
              call_to_action: { type: variant.cta, value: { link: 'https://www.kshetejsareen.com' } },
            },
          },
          access_token: token,
        }),
      })
      const cr = await crRes.json()
      if (cr.error) throw new Error(`Creative: ${cr.error.message}`)

      // 5 — Ad
      const adRes = await fetch(`https://graph.facebook.com/v20.0/act_${acct}/ads`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `KSS Ad · ${variant.angle || 'Variant'} · ${new Date().toLocaleDateString()}`,
          adset_id: adSet.id,
          creative: { creative_id: cr.id },
          status: 'PAUSED',
          access_token: token,
        }),
      })
      const ad = await adRes.json()
      if (ad.error) throw new Error(`Ad: ${ad.error.message}`)

      showToast('Campaign created ✓ — review in Ads Manager before activating')
    } catch(e) { showToast('Campaign failed: ' + e.message) }
    finally { setPublishing(false) }
  }, [state, selectedImg, objective, placement, funnel, targeting, buildTargetingSpec, showToast])

  // ── Render ────────────────────────────────────────────

  const v = variants[selectedIdx] || null

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: IMAGE FILMSTRIP ── */}
      <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 8, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase' }}>
            {visibleImages.length} image{visibleImages.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div ref={filmRef} style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4, scrollbarWidth: 'thin', scrollbarColor: '#1E1E1E transparent' }}>
          {visibleImages.length === 0 ? (
            <div style={{ fontSize: 9, color: '#2A2A2A', fontFamily: 'var(--font-mono)', padding: '12px 4px', lineHeight: 1.6 }}>Upload images to begin</div>
          ) : visibleImages.map(img => {
            const isSelected = selectedImg?.id === img.id
            const aspect = img.width && img.height ? img.height / img.width : 1.25
            return (
              <div key={img.id} onClick={() => setSelectedImgId(img.id)}
                style={{ width: '100%', aspectRatio: `1 / ${aspect.toFixed(3)}`, borderRadius: 3, overflow: 'hidden', cursor: 'pointer', outline: isSelected ? '2px solid var(--silver)' : '2px solid transparent', outlineOffset: 1, transition: 'outline-color .1s', flexShrink: 0 }}>
                <img src={img.dataUrl} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
              </div>
            )
          })}
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* ── TOP BAR ── */}
        <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-raised)', padding: '0 14px', overflow: 'hidden' }}>

          {/* Brief input */}
          <input
            className="input"
            value={adContext}
            onChange={e => { setAdContext(e.target.value); localStorage.setItem('kss_ad_context', e.target.value) }}
            placeholder="Ad brief — product, offer, audience…"
            style={{ flex: 1, fontSize: 10, height: 28, minWidth: 0, marginRight: 12, background: 'transparent', border: '1px solid var(--border)' }}
          />

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', marginRight: 10, flexShrink: 0 }} />

          {/* Objective pills */}
          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            {OBJECTIVES.map(o => {
              const objTips = {
                OUTCOME_AWARENESS:     "Awareness — Show your studio to new people who've never heard of you. Optimises for reach and brand recall. Best paired with TOFU.",
                OUTCOME_TRAFFIC:       "Traffic — Drive clicks to your website or portfolio. Best when you have a strong landing page ready.",
                OUTCOME_ENGAGEMENT:    "Engagement — Get likes, comments, saves, shares. Builds social proof. Best for content that provokes a reaction or starts a conversation.",
                OUTCOME_LEADS:         "Leads — Collect contact info via Meta's instant form. Best for 'Book a consultation' or 'Get a quote' campaigns.",
                OUTCOME_APP_PROMOTION: "App — Drive app installs or in-app activity. Rarely used for a photography studio.",
                OUTCOME_SALES:         "Sales — Drive purchases or conversions. Requires a Facebook Pixel on your website. Best for BOFU retargeting of warm audiences.",
              }
              return (
                <Tip key={o.id} text={objTips[o.id]}>
                  <button onClick={() => setObjective(o.id)}
                    style={{ padding: '3px 7px', fontSize: 8, fontFamily: 'var(--font-mono)', background: objective === o.id ? 'var(--silver-glow)' : 'none', border: `1px solid ${objective === o.id ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: objective === o.id ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {o.label}
                  </button>
                </Tip>
              )
            })}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 10px', flexShrink: 0 }} />

          {/* Placement pills */}
          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            {PLACEMENTS.map(p => {
              const placeTips = {
                feed:   "Feed 4:5 — 1080×1350px. Takes up maximum screen space in the scroll. Best format for brand imagery and portfolio showcase.",
                story:  "Stories 9:16 — 1080×1920px. Full-screen, high attention, disappears after 24h. Best for urgency and behind-the-scenes moments.",
                reels:  "Reels 9:16 — 1080×1920px. Currently the highest organic reach format on Instagram. Permanent unlike Stories.",
                square: "Square 1:1 — 1080×1080px. Classic Instagram format. Good for Facebook Feed cross-posting.",
              }
              return (
                <Tip key={p.id} text={placeTips[p.id]}>
                  <button onClick={() => setPlacement(p.id)}
                    style={{ padding: '3px 7px', fontSize: 8, fontFamily: 'var(--font-mono)', background: placement === p.id ? 'var(--silver-glow)' : 'none', border: `1px solid ${placement === p.id ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: placement === p.id ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {p.label}
                  </button>
                </Tip>
              )
            })}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 10px', flexShrink: 0 }} />

          {/* Funnel pills */}
          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            {FUNNEL.map(f => {
              const funnelTips = {
                tofu: "TOFU — Top of Funnel\nCold audience who've never heard of your studio. Copy should educate and build desire — never hard sell to a cold audience.",
                mofu: "MOFU — Middle of Funnel\nWarm audience who've seen your content or visited your profile. Deepen the story, show proof of work, address objections.",
                bofu: "BOFU — Bottom of Funnel\nHot retargeting audience who already know you. Cut straight to the offer. Create urgency. Direct CTA.",
              }
              return (
                <Tip key={f.id} text={funnelTips[f.id]}>
                  <button onClick={() => setFunnel(f.id)}
                    style={{ padding: '3px 7px', fontSize: 8, fontFamily: 'var(--font-mono)', background: funnel === f.id ? 'var(--silver-glow)' : 'none', border: `1px solid ${funnel === f.id ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: funnel === f.id ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {f.label}
                  </button>
                </Tip>
              )
            })}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 10px', flexShrink: 0 }} />

          {/* Advantage+ toggle */}
          <Tip text="Advantage+ Mode — Meta's AI finds the right audience by reading your creative. Copy auto-includes client-type signals so the algorithm can self-target without manual interest lists. Often outperforms manual targeting.">
            <button onClick={() => setAdvPlus(a => !a)}
              title={advPlus ? 'Advantage+ ON — AI self-targets from creative signals. Click to switch to manual.' : 'Advantage+ OFF — using manual interest targeting. Click to enable AI targeting.'}
              style={{ padding: '3px 10px', fontSize: 8, fontFamily: 'var(--font-mono)', background: advPlus ? 'rgba(100,120,255,.15)' : 'none', border: `1px solid ${advPlus ? 'rgba(100,120,255,.5)' : 'var(--border)'}`, borderRadius: 2, color: advPlus ? 'rgba(140,160,255,.95)' : 'var(--mute)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: advPlus ? 600 : 400 }}>
              {advPlus ? '⚡ Adv+ ON' : 'Adv+'}
            </button>
          </Tip>
        </div>

        {/* ── VARIANT AREA ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

          {/* Variant tabs — only shown when variants exist */}
          {variants.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              {variants.map((_, i) => (
                <button key={i} onClick={() => setSelectedIdx(i)}
                  style={{ width: 28, height: 28, borderRadius: 3, fontSize: 11, fontFamily: 'var(--font-mono)', background: selectedIdx === i ? 'var(--silver-glow)' : 'none', border: `1px solid ${selectedIdx === i ? 'var(--silver-border)' : 'var(--border)'}`, color: selectedIdx === i ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer' }}>
                  {i + 1}
                </button>
              ))}
              {v && (
                <span style={{ fontSize: 8, color: 'rgba(80,150,240,.7)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginLeft: 6 }}>
                  {v.angle}
                </span>
              )}
              <button className="btn btn-ghost btn-xs" style={{ marginLeft: 'auto' }} onClick={() => setVariants([])}>Clear</button>
            </div>
          )}

          {/* Variant content or empty state */}
          {variants.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text2)' }}>
              {selectedImg ? (
                <>
                  <img src={selectedImg.dataUrl} alt="" style={{ maxHeight: 160, maxWidth: '35%', objectFit: 'contain', opacity: .1, borderRadius: 4 }} />
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>Set the brief · choose objective · generate</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 28, opacity: .05 }}>◻</div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>Select an image from the filmstrip</div>
                </>
              )}
            </div>
          ) : v ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', gap: 24, alignItems: 'flex-start', minHeight: 0 }}>

              {/* LEFT: image at correct aspect ratio */}
              {selectedImg && (
                <div style={{ flexShrink: 0, width: 'min(360px, 40%)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ width: '100%', aspectRatio: placement === 'square' ? '1/1' : placement === 'feed' ? '4/5' : '9/16', overflow: 'hidden' }}>
                    <img src={selectedImg.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                </div>
              )}

              {/* RIGHT: copy fields */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

                {/* Hook */}
                <div style={{ fontSize: 20, color: 'var(--silver)', fontFamily: 'var(--font-body)', fontStyle: 'italic', lineHeight: 1.4 }}>
                  &ldquo;{v.hook}&rdquo;
                </div>

                {/* Primary Text */}
                {(() => {
                  const pt = charMeta(v.primaryText, 125)
                  return (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 8, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Primary Text</span>
                        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: pt.color }}>{pt.len}/125</span>
                      </div>
                      <textarea
                        value={v.primaryText}
                        onChange={e => setVariants(prev => prev.map((vv, j) => j === selectedIdx ? { ...vv, primaryText: e.target.value } : vv))}
                        rows={3}
                        style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-body)', color: pt.over ? 'rgba(220,90,90,.9)' : 'var(--text2)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '7px 9px', resize: 'vertical', lineHeight: 1.5, outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                  )
                })()}

                {/* Headline */}
                {(() => {
                  const hl = charMeta(v.headline, 40)
                  return (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 8, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Headline</span>
                        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: hl.color }}>{hl.len}/40</span>
                      </div>
                      <input
                        value={v.headline}
                        onChange={e => setVariants(prev => prev.map((vv, j) => j === selectedIdx ? { ...vv, headline: e.target.value } : vv))}
                        style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-body)', color: hl.over ? 'rgba(220,90,90,.9)' : 'var(--text2)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '7px 9px', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                  )
                })()}

                {/* Description */}
                {(() => {
                  const ds = charMeta(v.description, 30)
                  return (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 8, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Description</span>
                        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: ds.color }}>{ds.len}/30</span>
                      </div>
                      <input
                        value={v.description}
                        onChange={e => setVariants(prev => prev.map((vv, j) => j === selectedIdx ? { ...vv, description: e.target.value } : vv))}
                        style={{ width: '100%', fontSize: 11, fontFamily: 'var(--font-body)', color: ds.over ? 'rgba(220,90,90,.9)' : 'var(--text2)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '7px 9px', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                  )
                })()}

                {/* CTA select */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 8, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', flexShrink: 0 }}>CTA</span>
                  <select
                    value={v.cta}
                    onChange={e => setVariants(prev => prev.map((vv, j) => j === selectedIdx ? { ...vv, cta: e.target.value } : vv))}
                    style={{ fontSize: 10, fontFamily: 'var(--font-mono)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '5px 8px', color: 'var(--silver)', cursor: 'pointer' }}>
                    {CTA_OPTIONS.map(cta => (
                      <option key={cta} value={cta}>{CTA_LABELS[cta] || cta}</option>
                    ))}
                  </select>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => copyVariant(v)}>Copy text</button>
                  <button className="btn btn-ghost btn-sm" onClick={downloadImage}>&#8595; {activePlacement?.w}&times;{activePlacement?.h}</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── TARGETING PANEL ── */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
          <button onClick={() => setTargetingOpen(o => !o)}
            style={{ width: '100%', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontSize: 8, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', flexShrink: 0 }}>Targeting</span>
            {!targetingOpen && (
              <span style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {targetingSummary()}
              </span>
            )}
            <span style={{ fontSize: 8, color: 'var(--mute)', marginLeft: 'auto', flexShrink: 0 }}>{targetingOpen ? '▲' : '▼'}</span>
          </button>

          {targetingOpen && (
            <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 320, overflowY: 'auto' }}>

              {/* Advantage+ notice */}
              {advPlus && (
                <div style={{ padding: '8px 10px', background: 'rgba(100,120,255,.07)', border: '1px solid rgba(100,120,255,.25)', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>⚡</span>
                  <div style={{ fontSize: 9, color: 'rgba(160,175,255,.85)', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
                    <strong style={{ color: 'rgba(180,190,255,.95)' }}>Advantage+ Audience is ON.</strong> Set broad demographics below — no interests needed. Meta AI will self-target based on your creative. In Ads Manager, select "Advantage+ Audience" at the Ad Set level.
                  </div>
                </div>
              )}

              {/* Demographics row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>

                {/* Age */}
                <div>
                  <div style={{ fontSize: 7, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 5 }}>Age range</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="number" min={18} max={64} value={targeting.ageMin}
                      onChange={e => setTargeting(t => ({ ...t, ageMin: +e.target.value }))}
                      style={{ width: 44, fontSize: 10, textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', padding: '3px 4px' }} />
                    <span style={{ fontSize: 9, color: 'var(--mute)' }}>–</span>
                    <input type="number" min={19} max={65} value={targeting.ageMax}
                      onChange={e => setTargeting(t => ({ ...t, ageMax: +e.target.value }))}
                      style={{ width: 44, fontSize: 10, textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', padding: '3px 4px' }} />
                  </div>
                </div>

                {/* Gender */}
                <div>
                  <div style={{ fontSize: 7, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 5 }}>Gender</div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[['All', []], ['Men', [1]], ['Women', [2]]].map(([label, val]) => {
                      const active = JSON.stringify(targeting.genders) === JSON.stringify(val)
                      return (
                        <button key={label} onClick={() => setTargeting(t => ({ ...t, genders: val }))}
                          style={{ padding: '3px 7px', fontSize: 8, fontFamily: 'var(--font-mono)', background: active ? 'var(--silver-glow)' : 'none', border: `1px solid ${active ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: active ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer' }}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Budget */}
                <div>
                  <div style={{ fontSize: 7, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 5 }}>Daily Budget</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>₹</span>
                    <input type="number" min={100} step={100} value={targeting.budgetDaily}
                      onChange={e => setTargeting(t => ({ ...t, budgetDaily: +e.target.value }))}
                      style={{ width: 72, fontSize: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', padding: '3px 6px' }} />
                  </div>
                </div>
              </div>

              {/* Cities — hidden in Advantage+ mode */}
              {!advPlus && <div>
                <div style={{ fontSize: 7, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>Cities</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {INDIA_CITIES.map(city => {
                    const active = targeting.cities.includes(city)
                    return (
                      <button key={city} onClick={() => setTargeting(t => ({ ...t, cities: active ? t.cities.filter(c => c !== city) : [...t.cities, city] }))}
                        style={{ padding: '3px 8px', fontSize: 8, fontFamily: 'var(--font-mono)', background: active ? 'var(--silver-glow)' : 'none', border: `1px solid ${active ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: active ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer' }}>
                        {city}
                      </button>
                    )
                  })}
                </div>
                {targeting.cities.length === 0 && (
                  <div style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginTop: 4, opacity: .6 }}>None selected — targeting all of India</div>
                )}
              </div>}

              {/* Interests — hidden in Advantage+ mode */}
              {!advPlus && <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 7, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Interests</div>
                  <div style={{ fontSize: 7, color: 'rgba(80,140,230,.55)', fontFamily: 'var(--font-mono)' }}>IDs resolve via Meta API when token is added</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {INTEREST_GROUPS.map(grp => (
                    <div key={grp.group}>
                      <div style={{ fontSize: 7, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 5, opacity: .65 }}>{grp.group}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {grp.items.map(name => {
                          const active = targeting.interests.includes(name)
                          return (
                            <button key={name} onClick={() => setTargeting(t => ({ ...t, interests: active ? t.interests.filter(i => i !== name) : [...t.interests, name] }))}
                              style={{ padding: '3px 8px', fontSize: 8, fontFamily: 'var(--font-mono)', background: active ? 'var(--silver-glow)' : 'none', border: `1px solid ${active ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: active ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer' }}>
                              {name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>}

              {/* Token pending notice */}
              {!state.settings.metaToken && (
                <div style={{ fontSize: 8, color: 'rgba(220,160,0,.75)', fontFamily: 'var(--font-mono)', lineHeight: 1.6, padding: '6px 9px', background: 'rgba(220,160,0,.05)', border: '1px solid rgba(220,160,0,.15)', borderRadius: 3 }}>
                  Meta token verification pending. Targeting matrix is fully configured and ready — campaign push enables automatically once the token is added to Settings.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 8 }}>
          <Tip text="Generate 3 Ad Variants — Claude Opus looks at your image and brief, then writes 3 complete ad sets: Hook, Primary Text (≤125 chars), Headline (≤40 chars), Description (≤30 chars), and CTA. Each variant uses a different angle and strategy.">
            <button className="plan-btn" style={{ flex: 1 }} onClick={generate} disabled={generating || !selectedImg}>
              {generating ? <><span className="spin" /> Generating variants&hellip;</> : '✦ Generate 3 Ad Variants'}
            </button>
          </Tip>
          {variants.length > 0 && (
            <>
              {selectedImg && (
                <Tip text="Download All Formats — Exports Feed 4:5, Stories 9:16, and Reels 9:16 in one click. Upload all three to Meta — Advantage+ will test which placement works best for each audience segment.">
                  <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={downloadAllFormats}
                    title="Download Feed 4:5 + Stories 9:16 + Reels 9:16 for Advantage+ placements">
                    ↓ All Formats
                  </button>
                </Tip>
              )}
              <Tip text="Export Campaign Brief — Opens a step-by-step guide with all your settings pre-filled. Copy and paste directly into Meta Ads Manager field by field. Includes instructions for Campaign, Ad Set targeting, and all 3 ads.">
                <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => setShowBrief(true)}
                  title="Export full campaign brief — copy/paste into Meta Ads Manager">
                  ↗ Export Brief
                </button>
              </Tip>
              <Tip text="Push to Meta Ads Manager — Creates the full campaign via API: Campaign → Ad Set with targeting → Image upload → Creative → Ad. Always created as PAUSED so you can review before going live.">
                <button className="btn btn-ghost btn-sm"
                  style={{ color: state.settings.metaToken ? 'rgba(74,122,191,.9)' : 'var(--mute)', borderColor: state.settings.metaToken ? 'rgba(74,122,191,.3)' : 'var(--border)', flexShrink: 0 }}
                  onClick={() => v && pushCampaign(v)}
                  disabled={publishing || !state.settings.metaToken || !state.settings.adAccountId}
                  title={!state.settings.metaToken ? 'Meta token verification pending' : 'Push full campaign to Meta Ads Manager'}>
                  {publishing ? <><span className="spin" /> Pushing&hellip;</> : !state.settings.metaToken ? '⏳ Token pending' : '↑ Push Campaign'}
                </button>
              </Tip>
            </>
          )}
        </div>
      </div>

      {/* ── EXPORT BRIEF MODAL ── */}
      {showBrief && variants.length > 0 && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(6px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => e.target === e.currentTarget && setShowBrief(false)}>
          <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 8, width: '100%', maxWidth: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Modal header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--silver)', fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Campaign Brief</div>
                <div style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {OBJECTIVES.find(o => o.id === objective)?.label} · {activePlacement?.label} · {FUNNEL.find(f => f.id === funnel)?.label} · {targetingSummary()}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {selectedImg && (
                  <button className="btn btn-ghost btn-sm" onClick={downloadAll}>
                    ↓ Download all {variants.length} images
                  </button>
                )}
                <button onClick={() => setShowBrief(false)} style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
              </div>
            </div>

            {/* Meta Ads Manager field-by-field instructions */}
            <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Campaign setup */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '12px 14px' }}>
                <div style={{ fontSize: 9, color: 'rgba(80,160,240,.8)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>Step 1 — Campaign (one time)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', alignItems: 'start' }}>
                  {[
                    ['Campaign name',  `KSS · ${OBJECTIVES.find(o => o.id === objective)?.label} · ${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`],
                    ['Objective',      OBJECTIVES.find(o => o.id === objective)?.label + ' — select this in the "Campaign objective" screen'],
                    ['Special categories', 'None — leave all unchecked'],
                    ['Campaign budget', 'Off — set budget at Ad Set level'],
                  ].map(([label, val]) => (
                    <>
                      <div key={`l-${label}`} style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', paddingTop: 2 }}>{label}</div>
                      <CopyRow key={`v-${label}`} text={val} />
                    </>
                  ))}
                </div>
              </div>

              {/* Ad Set */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '12px 14px' }}>
                <div style={{ fontSize: 9, color: 'rgba(80,160,240,.8)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 10 }}>Step 2 — Ad Set (targeting + budget)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', alignItems: 'start' }}>
                  {[
                    ['Ad Set name',   `${activePlacement?.label} · ${targeting.cities.length ? targeting.cities.slice(0,3).join(', ') : 'India'} · ${targeting.ageMin}–${targeting.ageMax}`],
                    ['Daily budget',  `₹${targeting.budgetDaily.toLocaleString()}`],
                    ['Schedule',      targeting.ongoing ? 'Set start date, no end date' : `Start: ${targeting.startDate}`],
                    ['Audience mode',  advPlus ? 'Advantage+ Audience — toggle it ON at the top of the Audience section. Set suggested demographic only, leave interests empty.' : 'Manual targeting'],
                    ['Locations',     !advPlus && targeting.cities.length ? targeting.cities.join(', ') : 'India (country-level)'],
                    ['Age',           `${targeting.ageMin} – ${targeting.ageMax}`],
                    ['Gender',        targeting.genders.length === 0 ? 'All genders' : targeting.genders[0] === 1 ? 'Men only' : 'Women only'],
                    ...(!advPlus && targeting.interests.length ? [['Detailed targeting', targeting.interests.join(', ') + '\n(search each one in the "Add interests" field)']] : []),
                    ['Placements',    advPlus ? 'Advantage+ placements — leave on Automatic. Meta tests Feed, Stories, Reels.' : `Manual → Instagram only → ${placement === 'feed' ? 'Feed' : placement === 'story' ? 'Stories' : 'Reels'}`],
                    ...(advPlus ? [['Advantage+ Creative', 'Enable at the Ad level — Meta auto-generates creative variants']] : []),
                  ].map(([label, val]) => (
                    <>
                      <div key={`l-${label}`} style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', paddingTop: 2 }}>{label}</div>
                      <CopyRow key={`v-${label}`} text={val} />
                    </>
                  ))}
                </div>
              </div>

              {/* The 3 ads */}
              {variants.map((vv, i) => (
                <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: 'rgba(80,160,240,.8)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', flex: 1 }}>
                      Step {3 + i} — Ad {i + 1} of {variants.length}: {vv.angle}
                    </div>
                    <button className="btn btn-ghost btn-xs" onClick={() => {
                      const text = `AD ${i+1}: ${vv.angle}\n\nPRIMARY TEXT:\n${vv.primaryText}\n\nHEADLINE:\n${vv.headline}\n\nDESCRIPTION:\n${vv.description}\n\nCTA: ${CTA_LABELS[vv.cta] || vv.cta}`
                      navigator.clipboard.writeText(text).then(() => showToast(`Ad ${i+1} copied ✓`))
                    }}>Copy all</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', alignItems: 'start' }}>
                    {[
                      ['Ad name',        `Ad ${i+1} · ${vv.angle}`],
                      ['Image',          `Download "ad-v${i+1}-${placement}-${activePlacement?.w}x${activePlacement?.h}.jpg" from KSS Studio → upload here`],
                      ['Primary text',   vv.primaryText],
                      ['Headline',       vv.headline],
                      ['Description',    vv.description],
                      ['Call to action', CTA_LABELS[vv.cta] || vv.cta],
                      ['Website URL',    'https://www.kshetejsareen.com'],
                    ].map(([label, val]) => (
                      <>
                        <div key={`l-${label}`} style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', paddingTop: 2 }}>{label}</div>
                        <CopyRow key={`v-${label}`} text={val} muted={val.startsWith('Download')} />
                      </>
                    ))}
                  </div>
                </div>
              ))}

              {/* Final note */}
              <div style={{ padding: '10px 12px', background: 'rgba(80,160,80,.05)', border: '1px solid rgba(80,160,80,.15)', borderRadius: 4, fontSize: 9, color: 'rgba(80,180,80,.7)', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
                ✓ Create all 3 ads inside the same Ad Set — Meta will automatically optimise delivery between them (Dynamic Creative Testing).<br/>
                ✓ Leave all ads in Review state — do not publish until you have reviewed the preview on mobile.<br/>
                ✓ After review, set Status to Active on all 3 together.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Inline copy-row helper — copyable field value
function CopyRow({ text, muted }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <div style={{ fontSize: 10, color: muted ? 'var(--mute)' : 'var(--text2)', fontFamily: muted ? 'var(--font-mono)' : 'var(--font-body)', lineHeight: 1.5, flex: 1, whiteSpace: 'pre-wrap' }}>{text}</div>
      {!muted && (
        <button onClick={copy}
          style={{ flexShrink: 0, marginTop: 1, padding: '2px 7px', fontSize: 8, fontFamily: 'var(--font-mono)', background: copied ? 'rgba(80,180,80,.12)' : 'none', border: `1px solid ${copied ? 'rgba(80,180,80,.3)' : 'var(--border)'}`, borderRadius: 2, color: copied ? 'rgba(80,180,80,.8)' : 'var(--mute)', cursor: 'pointer', transition: 'all .15s' }}>
          {copied ? '✓' : 'Copy'}
        </button>
      )}
    </div>
  )
}
