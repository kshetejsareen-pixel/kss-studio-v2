import { useState, useCallback, useRef } from 'react'
import { useStore, claudeVision, M_OPUS } from '../store.jsx'

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

const AD_SYSTEM = (context, objective, placement, funnel) => {
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

// ── CHARACTER COUNT HELPER ────────────────────────────────

function charMeta(text, limit) {
  const len = (text || '').length
  const over = len > limit
  const warn = len > limit * 0.88
  const color = over ? 'rgba(220,70,70,.9)' : warn ? 'rgba(220,160,0,.85)' : 'var(--text3)'
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
      const system = AD_SYSTEM(adContext, objective, placement, funnel)
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
  }, [state, selectedImg, adContext, objective, placement, funnel, showToast])

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

  // ── Push to Meta Ads Manager ──────────────────────────

  const publishToMeta = useCallback(async (v) => {
    const token       = state.settings.metaToken
    const adAccountId = state.settings.adAccountId
    const igActorId   = state.settings.igAccountId
    if (!token)       { showToast('Add Meta token in Settings');      return }
    if (!adAccountId) { showToast('Add Ad Account ID in Settings');   return }
    if (!selectedImg) { showToast('Select an image first');           return }
    setPublishing(true)
    try {
      // Upload image
      const b64       = selectedImg.dataUrl.split(',')[1]
      const upRes     = await fetch(`https://graph.facebook.com/v20.0/act_${adAccountId}/adimages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bytes: b64, access_token: token }),
      })
      const upData    = await upRes.json()
      if (!upRes.ok)  throw new Error(upData.error?.message || 'Image upload failed')
      const imageHash = Object.values(upData.images || {})[0]?.hash
      if (!imageHash) throw new Error('No image hash returned from Meta')

      // Create ad creative
      const crRes     = await fetch(`https://graph.facebook.com/v20.0/act_${adAccountId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `KSS · ${OBJECTIVES.find(o => o.id === objective)?.label} · ${new Date().toLocaleDateString()}`,
          object_story_spec: {
            ...(igActorId ? { instagram_actor_id: igActorId } : {}),
            link_data: {
              image_hash: imageHash,
              link:        `https://www.kshetejsareen.com`,
              message:     v.primaryText,
              name:        v.headline,
              description: v.description,
              call_to_action: {
                type:  v.cta,
                value: { link: `https://www.kshetejsareen.com` },
              },
            },
          },
          access_token: token,
        }),
      })
      const crData    = await crRes.json()
      if (!crRes.ok)  throw new Error(crData.error?.message || 'Creative creation failed')
      showToast(`Creative created in Ads Manager ✓`)
    } catch(e) { showToast('Meta publish failed: ' + e.message) }
    finally { setPublishing(false) }
  }, [state, selectedImg, objective, showToast])

  // ── Render ────────────────────────────────────────────

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 296px', height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: IMAGE SELECTOR ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)', background: '#060606' }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 8, color: 'var(--text3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase' }}>
            {visibleImages.length} image{visibleImages.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div ref={filmRef} style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4, scrollbarWidth: 'thin', scrollbarColor: '#1E1E1E transparent' }}>
          {visibleImages.length === 0 ? (
            <div style={{ fontSize: 9, color: '#2A2A2A', fontFamily: 'var(--font-mono)', padding: '12px 4px', lineHeight: 1.6 }}>Upload images to begin</div>
          ) : visibleImages.map(img => {
            const isSelected = selectedImg?.id === img.id
            const aspect     = img.width && img.height ? img.height / img.width : 1.25
            return (
              <div key={img.id} onClick={() => setSelectedImgId(img.id)}
                style={{ width: '100%', aspectRatio: `1 / ${aspect.toFixed(3)}`, borderRadius: 3, overflow: 'hidden', cursor: 'pointer', outline: isSelected ? '2px solid var(--silver)' : '2px solid transparent', outlineOffset: 1, transition: 'outline-color .1s', flexShrink: 0 }}>
                <img src={img.dataUrl} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
              </div>
            )
          })}
        </div>
      </div>

      {/* ── CENTER: VARIANTS ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-raised)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, color: 'var(--text2)', fontFamily: 'var(--font-mono)', letterSpacing: '.08em' }}>
            {OBJECTIVES.find(o => o.id === objective)?.label}
          </span>
          <span style={{ color: 'var(--border)', fontSize: 10 }}>·</span>
          <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{activePlacement?.label}</span>
          <span style={{ color: 'var(--border)', fontSize: 10 }}>·</span>
          <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{FUNNEL.find(f => f.id === funnel)?.label}</span>
          {variants.length > 0 && (
            <button className="btn btn-ghost btn-xs" style={{ marginLeft: 'auto' }} onClick={() => setVariants([])}>Clear</button>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, minHeight: 0 }}>
          {variants.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text3)' }}>
              {selectedImg ? (
                <>
                  <img src={selectedImg.dataUrl} alt="" style={{ maxHeight: 180, maxWidth: '45%', objectFit: 'contain', opacity: .12, borderRadius: 4 }} />
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>Configure objective → Generate 3 variants</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 28, opacity: .05 }}>◻</div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>Select an image from the left panel</div>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, alignItems: 'start' }}>
              {variants.map((v, i) => {
                const pt = charMeta(v.primaryText, 125)
                const hl = charMeta(v.headline, 40)
                const ds = charMeta(v.description, 30)
                const isSel = selectedIdx === i
                return (
                  <div key={i} onClick={() => setSelectedIdx(i)}
                    style={{ borderRadius: 4, border: `1px solid ${isSel ? 'var(--silver-edge)' : 'var(--border)'}`, background: isSel ? 'rgba(200,200,204,.04)' : 'var(--surface)', cursor: 'pointer', overflow: 'hidden', transition: 'border-color .12s' }}>

                    {/* Image preview at correct aspect ratio */}
                    {selectedImg && (
                      <div style={{ width: '100%', aspectRatio: placement === 'square' ? '1/1' : placement === 'feed' ? '4/5' : '9/16', overflow: 'hidden', maxHeight: 140, position: 'relative' }}>
                        <img src={selectedImg.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                        {isSel && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--silver)' }} />}
                      </div>
                    )}

                    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

                      {/* Variant label */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 7, color: 'rgba(80,150,240,.7)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{v.angle}</span>
                        <span style={{ fontSize: 7, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>#{i + 1}</span>
                      </div>

                      {/* Hook */}
                      <div style={{ fontSize: 11, color: 'var(--silver)', fontFamily: 'var(--font-body)', lineHeight: 1.45, fontWeight: 500, fontStyle: 'italic' }}>
                        "{v.hook}"
                      </div>

                      {/* Fields with char counts */}
                      {[
                        ['Primary Text', v.primaryText, pt, 125],
                        ['Headline',     v.headline,     hl,  40],
                        ['Description',  v.description,  ds,  30],
                      ].map(([label, text, meta, limit]) => (
                        <div key={label}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                            <span style={{ fontSize: 7, color: 'var(--text3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{label}</span>
                            <span style={{ fontSize: 7, fontFamily: 'var(--font-mono)', color: meta.color }}>{meta.len}/{limit}</span>
                          </div>
                          <div style={{ fontSize: 10, color: meta.over ? 'rgba(220,90,90,.9)' : 'var(--text2)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}>{text}</div>
                        </div>
                      ))}

                      {/* CTA chip */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 7, color: 'var(--text3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase' }}>CTA</span>
                        <span style={{ fontSize: 8, color: 'var(--silver)', fontFamily: 'var(--font-mono)', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 2, padding: '2px 7px' }}>
                          {CTA_LABELS[v.cta] || v.cta}
                        </span>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <button className="btn btn-ghost btn-xs" style={{ flex: 1 }}
                          onClick={e => { e.stopPropagation(); copyVariant(v) }}>
                          Copy text
                        </button>
                        <button className="btn btn-ghost btn-xs" style={{ flex: 1 }}
                          onClick={e => { e.stopPropagation(); downloadImage() }}>
                          ↓ {activePlacement?.w}×{activePlacement?.h}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: CONTROLS ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-raised)', borderLeft: '1px solid var(--border)' }}>

        {/* Image + brief header */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {selectedImg && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 3, overflow: 'hidden', border: '1px solid var(--silver-edge)', flexShrink: 0 }}>
                <img src={selectedImg.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedImg.name}</div>
                <div style={{ fontSize: 8, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{selectedImg.width}×{selectedImg.height}</div>
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 7, color: 'var(--text3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>Ad Brief</div>
            <textarea
              className="textarea"
              value={adContext}
              onChange={e => { setAdContext(e.target.value); localStorage.setItem('kss_ad_context', e.target.value) }}
              rows={3}
              placeholder="Describe this ad campaign — product, offer, target audience, key message. Separate from the planning brief."
              style={{ fontSize: 10, resize: 'none' }}
            />
          </div>
        </div>

        {/* Scrollable sections */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* Objective */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 7, color: 'var(--text3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>Objective</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {OBJECTIVES.map(o => (
                <button key={o.id} onClick={() => setObjective(o.id)}
                  style={{ padding: '7px 8px', textAlign: 'left', background: objective === o.id ? 'var(--silver-ghost)' : 'none', border: `1px solid ${objective === o.id ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', cursor: 'pointer', lineHeight: 1.3 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: objective === o.id ? 'var(--silver)' : 'var(--text2)', fontFamily: 'var(--font-mono)' }}>{o.label}</div>
                  <div style={{ fontSize: 7, color: 'var(--text3)', marginTop: 1 }}>{o.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Placement */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 7, color: 'var(--text3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>Placement</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {PLACEMENTS.map(p => (
                <button key={p.id} onClick={() => setPlacement(p.id)}
                  style={{ padding: '6px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', background: placement === p.id ? 'var(--silver-ghost)' : 'none', border: `1px solid ${placement === p.id ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: placement === p.id ? 'var(--silver)' : 'var(--text3)', cursor: 'pointer', lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 600 }}>{p.label}</div>
                  <div style={{ fontSize: 7, opacity: .6, marginTop: 1 }}>{p.w}×{p.h}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Funnel stage */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 7, color: 'var(--text3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>Audience Temperature</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {FUNNEL.map(f => (
                <button key={f.id} onClick={() => setFunnel(f.id)}
                  style={{ padding: '7px 10px', textAlign: 'left', background: funnel === f.id ? 'var(--silver-ghost)' : 'none', border: `1px solid ${funnel === f.id ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: funnel === f.id ? 'var(--silver)' : 'var(--text2)', fontFamily: 'var(--font-mono)', minWidth: 36 }}>{f.label}</span>
                  <span style={{ fontSize: 8, color: 'var(--text3)', lineHeight: 1.3 }}>{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Meta Publishing */}
          <div style={{ padding: '10px 14px' }}>
            <div style={{ fontSize: 7, color: 'var(--text3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 8 }}>Meta Ads Manager</div>
            {!state.settings.adAccountId ? (
              <div style={{ fontSize: 8, color: 'var(--text3)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
                Add your <span style={{ color: 'rgba(80,140,230,.7)' }}>Ad Account ID</span> in Settings to push creatives directly to Ads Manager.
              </div>
            ) : variants.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 8, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                  Variant #{selectedIdx + 1} · {CTA_LABELS[variants[selectedIdx]?.cta] || '—'}
                </div>
                <button className="btn btn-ghost btn-sm btn-full"
                  style={{ color: 'rgba(74,122,191,.9)', borderColor: 'rgba(74,122,191,.3)' }}
                  onClick={() => publishToMeta(variants[selectedIdx])}
                  disabled={publishing || !state.settings.metaToken}>
                  {publishing ? <><span className="spin" /> Pushing…</> : '↑ Push to Ads Manager'}
                </button>
                {!state.settings.metaToken && (
                  <div style={{ fontSize: 8, color: 'rgba(180,80,80,.7)', fontFamily: 'var(--font-mono)' }}>Add Meta token in Settings first</div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 8, color: 'var(--text3)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
                Generate variants to enable publishing.
              </div>
            )}
          </div>

        </div>

        {/* Generate button */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button className="plan-btn" onClick={generate} disabled={generating || !selectedImg}>
            {generating ? <><span className="spin" /> Generating variants…</> : '✦ Generate 3 Ad Variants'}
          </button>
        </div>
      </div>
    </div>
  )
}
