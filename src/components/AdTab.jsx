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

  const v = variants[selectedIdx] || null

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: IMAGE FILMSTRIP ── */}
      <div style={{ width: 160, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)', background: '#060606' }}>
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
            {OBJECTIVES.map(o => (
              <button key={o.id} onClick={() => setObjective(o.id)}
                style={{ padding: '3px 7px', fontSize: 8, fontFamily: 'var(--font-mono)', background: objective === o.id ? 'var(--silver-glow)' : 'none', border: `1px solid ${objective === o.id ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: objective === o.id ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {o.label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 10px', flexShrink: 0 }} />

          {/* Placement pills */}
          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            {PLACEMENTS.map(p => (
              <button key={p.id} onClick={() => setPlacement(p.id)}
                style={{ padding: '3px 7px', fontSize: 8, fontFamily: 'var(--font-mono)', background: placement === p.id ? 'var(--silver-glow)' : 'none', border: `1px solid ${placement === p.id ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: placement === p.id ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 10px', flexShrink: 0 }} />

          {/* Funnel pills */}
          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
            {FUNNEL.map(f => (
              <button key={f.id} onClick={() => setFunnel(f.id)}
                style={{ padding: '3px 7px', fontSize: 8, fontFamily: 'var(--font-mono)', background: funnel === f.id ? 'var(--silver-glow)' : 'none', border: `1px solid ${funnel === f.id ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: funnel === f.id ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {f.label}
              </button>
            ))}
          </div>
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

        {/* ── FOOTER ── */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 8 }}>
          <button className="plan-btn" style={{ flex: 1 }} onClick={generate} disabled={generating || !selectedImg}>
            {generating ? <><span className="spin" /> Generating variants&hellip;</> : '✦ Generate 3 Ad Variants'}
          </button>
          {state.settings.adAccountId && variants.length > 0 && (
            <button className="btn btn-ghost btn-sm"
              style={{ color: 'rgba(74,122,191,.9)', borderColor: 'rgba(74,122,191,.3)', flexShrink: 0 }}
              onClick={() => v && publishToMeta(v)}
              disabled={publishing || !state.settings.metaToken}>
              {publishing ? <><span className="spin" /> Pushing&hellip;</> : '&#8593; Push to Meta'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
