import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore, claudeVision, claudeCall, M_SONNET, M_HAIKU, exportPng, readFileAsDataUrl, resizeImage, extractBase64, PROXY } from '../store.jsx'

// ── SYSTEM PROMPTS ────────────────────────────────────────

const VISION_ANALYSIS_SYSTEM = `You are a visual composition analyst for a luxury photography studio. Analyse the image and return JSON:
{
  "focalPoint": "where the main subject sits",
  "negativeSpace": "where open/empty areas are — this is where text should live",
  "dominantTones": "describe the light quality and tonal range",
  "suggestedTextZone": "specific zone for text (e.g. upper-left third, bottom strip, right column)",
  "textContrast": "light or dark — what will read better against the image in that zone",
  "mood": "one word (cinematic / intimate / dramatic / airy / raw / refined / moody / charged)",
  "colorPalette": ["#hex1","#hex2","#hex3"],
  "typographyMood": "what typography personality fits (e.g. sharp geometric, flowing serif, stark mono, refined italic)",
  "composition": "rule of thirds / centered / asymmetric / leading lines / frame within frame"
}
Return ONLY valid JSON.`

const POST_SYSTEM = (handle, context, analysis, copy, website, direction) => `You are a director of design. You think like a creative director at a world-class agency — not a web developer, not a template maker.

Studio: ${handle}
Context: ${context || 'Luxury commercial photography studio'}
Website: ${website || 'www.kshetejsareen.com'}

Image intelligence from vision analysis:
- Focal point: ${analysis?.focalPoint || 'centre'}
- Negative space (text zone): ${analysis?.negativeSpace || 'variable'}
- Recommended text placement: ${analysis?.suggestedTextZone || 'use negative space'}
- Text should be: ${analysis?.textContrast || 'contrasting'} on image
- Image mood: ${analysis?.mood || 'refined'}
- Typography personality: ${analysis?.typographyMood || 'considered'}
- Composition type: ${analysis?.composition || 'asymmetric'}
- Colour palette from image: ${analysis?.colorPalette?.join(', ') || 'derive from image'}

${copy?.headline ? `Copy to use:
- Headline: "${copy.headline}"${copy.sub ? `\n- Subheadline: "${copy.sub}"` : ''}${copy.tagline ? `\n- Tagline: "${copy.tagline}"` : ''}${copy.cta ? `\n- CTA: "${copy.cta}"` : ''}${copy.website ? `\n- Website: "${copy.website}"` : ''}` : 'Generate appropriate copy from the image context.'}

${direction ? `Directorial intent: ${direction}` : 'No additional direction — let the image lead. Trust the composition.'}

Design principles:
- Typography, colour and layout must derive from the image itself — not from templates
- Use the image's own palette for any overlays, text colours, or accents
- Typography personality should match the image mood
- Text must sit in the identified negative space — never obscure the subject
- The design should feel like it was made for THIS image, not adapted from a template
- Luxury means restraint — one strong typographic moment, not many competing elements
- Include the website URL subtly — not as a focal point

Technical rules:
- Inline styles only — no external CSS files
- @import Google Fonts in a <style> tag if needed
- Div exactly 1080×1350px, position: relative, overflow: hidden
- Use src="[IMAGE_SRC]" for img, url('[IMAGE_SRC]') for CSS backgrounds
- Image must be visible and dominant
- Return ONLY the HTML div`

const STORY_SYSTEM = (handle, context, analysis, copy, website, direction) => `You are a director of design creating an Instagram Story for ${handle}.
Website: ${website || 'www.kshetejsareen.com'}
Context: ${context || 'Luxury photography'}

Vision analysis: text zone at ${analysis?.suggestedTextZone || 'open area'}, ${analysis?.textContrast || 'contrasting'} text, mood: ${analysis?.mood || 'refined'}, typography: ${analysis?.typographyMood || 'considered'}, palette: ${analysis?.colorPalette?.join(', ') || 'from image'}

${copy?.headline ? `Copy: Headline "${copy.headline}"${copy.sub ? `, Sub "${copy.sub}"` : ''}${copy.cta ? `, CTA "${copy.cta}"` : ''}` : 'Generate copy from image.'}
${direction ? `Direction: ${direction}` : 'Let the image lead.'}

Rules: Inline styles. Div 1080×1920px. src="[IMAGE_SRC]". Image visible and dominant. Return ONLY HTML div.`

const COPY_SYSTEM = (handle, context, website) => `You are a director of design and copywriter for ${handle}, a world-class commercial photography studio.
Context: ${context || 'Luxury photography'}
Website: ${website || 'www.kshetejsareen.com'}

Write with the authority of a creative director, not a copywriter following a brief.
Rules:
- Less is more — luxury brands say one thing, perfectly
- No clichés: "capturing moments", "timeless", "bespoke", "stunning", "through the lens"
- The headline should make you pause — not explain, but evoke
- CTA is always from KSS perspective — an invitation to work together, never a client promotion
- Website is always KSS: ${website || 'www.kshetejsareen.com'}

Return JSON only:
{
  "headline": "2-5 words maximum — the strongest version",
  "sub": "one line that adds context, or null",
  "tagline": "studio's voice — optional, or null",
  "cta": "KSS invitation (e.g. Book a shoot / Commission your story / Inquire now)",
  "website": "${website || 'www.kshetejsareen.com'}"
}
Return ONLY valid JSON.`

const REFINE_SYSTEM = `You are a front-end developer refining Instagram post HTML. 
The user will describe a change. Apply ONLY that specific change to the HTML.
Return the complete modified HTML div, nothing else. No explanation. No markdown.`

const INJECT_IMG = (html, dataUrl) => html
  .replace(/\[IMAGE_SRC\]/g, dataUrl)
  .replace(/\[SUBJECT_IMAGE\]/g, dataUrl)
  .replace(/src="placeholder[^"]*"/g, `src="${dataUrl}"`)
  .replace(/src='placeholder[^']*'/g, `src='${dataUrl}'`)
  .replace(/url\("placeholder[^"]*"\)/g, `url("${dataUrl}")`)
  .replace(/url\('placeholder[^']*'\)/g, `url('${dataUrl}')`)
  .replace(/url\(placeholder[^)]*\)/g, `url("${dataUrl}")`)

export default function StudioTab({ showToast }) {
  const { state, set } = useStore()
  const [mode, setMode]                   = useState('post')
  const [selectedImgId, setSelectedImgId] = useState(null)
  const [refImgDataUrl, setRefImgDataUrl] = useState(null)
  const [stylePrompt, setStylePrompt]     = useState('')
  const [generating, setGenerating]       = useState(false)
  const [genStep, setGenStep]             = useState('') // current generation step label
  const [exporting, setExporting]         = useState(false)
  const [designHtml, setDesignHtml]       = useState('')
  const [storyHtml, setStoryHtml]         = useState('')
  const [iterations, setIterations]       = useState([]) // { html, prompt, starred }
  const [starredHtml, setStarredHtml]     = useState(null)
  const [zoom, setZoom]                   = useState(1)
  const [filmSize, setFilmSize]           = useState(80)
  const [canvasSize, setCanvasSize]       = useState({ w: 600, h: 480 })

  // Copy panel
  const [copyPanel, setCopyPanel]         = useState(false)
  const [copy, setCopy]                   = useState({ headline: '', sub: '', tagline: '', cta: '', website: '' })
  const [lockedFields, setLockedFields]   = useState({ headline: false, sub: false, tagline: false, cta: false })
  const [generatingCopy, setGeneratingCopy] = useState(false)
  const website = copy.website || state.settings?.website || 'www.kshetejsareen.com'

  // Chat panel
  const [chatOpen, setChatOpen]           = useState(false)
  const [chatInput, setChatInput]         = useState('')
  const [chatHistory, setChatHistory]     = useState([])
  const [chatting, setChatting]           = useState(false)
  const chatEndRef = useRef(null)

  const canvasRef = useRef(null)
  const filmRef   = useRef(null)

  const selectedImg = state.images.find(i => i.id === selectedImgId) || state.images[0] || null

  // Measure canvas
  useEffect(() => {
    if (!canvasRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect
        if (width > 0 && height > 0) setCanvasSize({ w: width, h: height })
      }
    })
    ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [])

  // Zoom via wheel
  useEffect(() => {
    const el = canvasRef.current; if (!el) return
    const h = (e) => {
      e.preventDefault()
      setZoom(z => {
        const cur = z === 0 ? fitScale : z
        return Math.max(0.1, Math.min(3, +(cur + (e.deltaY < 0 ? 0.05 : -0.05)).toFixed(2)))
      })
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [designHtml, storyHtml])

  // Scroll filmstrip to selected
  useEffect(() => {
    if (!selectedImg || !filmRef.current) return
    const el = filmRef.current.querySelector(`[data-id="${selectedImg.id}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedImg?.id])

  // Auto scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatHistory])

  const handleRefImg = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    setRefImgDataUrl(await readFileAsDataUrl(file))
    showToast('Reference image loaded ✓')
  }

  // ── Generate AI Copy ──
  const generateCopy = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    if (!selectedImg) { showToast('Select an image first'); return }
    setGeneratingCopy(true)
    try {
      const system = COPY_SYSTEM(state.settings.handle || '@kshetej.atwork', state.globalContext, website)
      const lockedNote = Object.entries(lockedFields).filter(([,v])=>v).map(([k])=>k).join(', ')
      const prompt = `Generate copy for this image. Brand context: ${state.globalContext || 'luxury photography studio'}.
${lockedNote ? `These fields are locked — preserve exactly: ${lockedNote}` : ''}
${lockedFields.headline && copy.headline ? `Keep headline as: "${copy.headline}"` : ''}
${lockedFields.sub && copy.sub ? `Keep subheadline as: "${copy.sub}"` : ''}
${lockedFields.tagline && copy.tagline ? `Keep tagline as: "${copy.tagline}"` : ''}
${lockedFields.cta && copy.cta ? `Keep CTA as: "${copy.cta}"` : ''}
Look at what's in the image — copy must feel specific to it, not generic.`
      const raw = await claudeVision(key, system, prompt, selectedImg.dataUrl, M_HAIKU, 400)
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        setCopy(prev => ({
          headline: lockedFields.headline ? prev.headline : (parsed.headline || ''),
          sub:      lockedFields.sub      ? prev.sub      : (parsed.sub || ''),
          tagline:  lockedFields.tagline  ? prev.tagline  : (parsed.tagline || ''),
          cta:      lockedFields.cta      ? prev.cta      : (parsed.cta || ''),
          website:  prev.website || parsed.website || website,
        }))
        showToast('Copy generated ✓')
      }
    } catch(e) { showToast('Copy failed: ' + e.message) }
    finally { setGeneratingCopy(false) }
  }, [state, selectedImg, website, lockedFields, copy, showToast])

  // ── Generate design ──
  const generate = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    if (!selectedImg) { showToast('Select an image first'); return }
    setGenerating(true); setZoom(0); setChatHistory([])

    const isStory = mode === 'story'
    const w = 1080, h = isStory ? 1920 : 1350
    const handle = state.settings.handle || '@kshetej.atwork'
    const context = state.globalContext

    try {
      // Step 1 — Vision analysis for text placement
      let analysis = null
      setGenStep('Analysing image composition…')
      try {
        const raw = await claudeVision(key, VISION_ANALYSIS_SYSTEM, 'Analyse this image for layout purposes.', selectedImg.dataUrl, M_HAIKU, 400)
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) analysis = JSON.parse(match[0])
      } catch { /* non-fatal */ }

      // Step 2 — Generate design
      setGenStep('Generating design…')
      const hasCopy = copy.headline || copy.sub || copy.tagline
      const system = isStory
        ? STORY_SYSTEM(handle, context, analysis, hasCopy ? copy : null, website, stylePrompt)
        : POST_SYSTEM(handle, context, analysis, hasCopy ? copy : null, website, stylePrompt)

      const prompt = `Generate a ${isStory ? '1080×1920 Instagram Story' : '1080×1350 Instagram Post'} design.
Handle: ${handle} · Website: ${website}
CRITICAL: Use src="[IMAGE_SRC]" for the subject image. Div must be exactly ${w}px × ${h}px.
Think like a director of design — derive everything from the image itself.`

      let raw
      if (refImgDataUrl) {
        const bs = extractBase64(await resizeImage(selectedImg.dataUrl, 800))
        const br = extractBase64(await resizeImage(refImgDataUrl, 600))
        const r = await fetch(PROXY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: M_SONNET, max_tokens: 4000, system, messages: [{ role: 'user', content: [
            { type: 'text', text: 'Subject image:' },
            { type: 'image', source: { type: 'base64', media_type: bs.mediaType, data: bs.data } },
            { type: 'text', text: 'Reference image (match this style):' },
            { type: 'image', source: { type: 'base64', media_type: br.mediaType, data: br.data } },
            { type: 'text', text: prompt },
          ]}] }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        raw = (await r.json()).content?.find(b => b.type === 'text')?.text
      } else {
        raw = await claudeVision(key, system, prompt, selectedImg.dataUrl, M_SONNET, 4000)
      }

      if (!raw) throw new Error('Empty response')
      let html = raw.trim().replace(/^```html\n?/, '').replace(/\n?```$/, '').trim()
      html = INJECT_IMG(html, selectedImg.dataUrl)

      if (isStory) {
        setStoryHtml(html)
      } else {
        setDesignHtml(html)
        setIterations(prev => [{ html, prompt: stylePrompt || 'default', ts: Date.now(), starred: false }, ...prev].slice(0, 10))
      }
      showToast('Design generated ✓')
      if (analysis) showToast(`Text placed in ${analysis.suggestedTextZone}`)
    } catch(e) { showToast('Error: ' + e.message); console.error(e) }
    finally { setGenerating(false); setGenStep('') }
  }, [state, selectedImg, mode, stylePrompt, refImgDataUrl, copy, showToast])

  // ── Design chatbot ──
  const sendChat = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    const currentHtml = mode === 'story' ? storyHtml : designHtml
    if (!currentHtml) { showToast('Generate a design first'); return }
    if (!chatInput.trim()) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatHistory(h => [...h, { role: 'user', text: msg }])
    setChatting(true)
    try {
      const prompt = `Current HTML design:\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nChange requested: ${msg}\n\nReturn the complete modified HTML div only.`
      const result = await claudeCall(key, REFINE_SYSTEM, prompt, M_SONNET, 4000)
      let html = result.trim().replace(/^```html\n?/, '').replace(/\n?```$/, '').trim()
      html = INJECT_IMG(html, selectedImg?.dataUrl || '')
      if (mode === 'story') {
        setStoryHtml(html)
      } else {
        setDesignHtml(html)
        setIterations(prev => [{ html, prompt: msg, ts: Date.now(), starred: false }, ...prev].slice(0, 10))
      }
      setChatHistory(h => [...h, { role: 'assistant', text: 'Done ✓ ' + msg }])
    } catch(e) {
      setChatHistory(h => [...h, { role: 'assistant', text: 'Error: ' + e.message }])
    } finally { setChatting(false) }
  }, [state, mode, storyHtml, designHtml, chatInput, selectedImg, showToast])

  // ── Delete image ──
  const deleteImage = useCallback((imgId, e) => {
    e.stopPropagation()
    const newImages = state.images.filter(i => i.id !== imgId)
    set('images', newImages)
    if (selectedImgId === imgId) setSelectedImgId(null)
    showToast('Image removed')
  }, [state.images, selectedImgId, set, showToast])

  const currentHtml  = mode === 'story' ? storyHtml : designHtml
  const canvasDims   = mode === 'story' ? { w: 1080, h: 1920 } : { w: 1080, h: 1350 }
  // fitScale fills the measured canvas with 8px padding on each side
  const fitScale     = canvasSize.w > 0 && canvasSize.h > 0
    ? Math.min((canvasSize.w - 48) / canvasDims.w, (canvasSize.h - 48) / canvasDims.h)
    : 0.3
  // zoom is an absolute scale value, not a multiplier
  // default zoom=0 means "fit to container"
  const displayScale = zoom === 0 ? fitScale : zoom
  const getFrameW    = (img) => Math.round(filmSize * (img.width && img.height ? img.width / img.height : 0.75))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 288px', gap: 0, height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: CANVAS + FILMSTRIP ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
          {['post', 'story'].map(m => (
            <button key={m} onClick={() => { setMode(m); setZoom(0) }}
              style={{ padding: '5px 14px', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', background: mode === m ? 'var(--silver-ghost)' : 'none', border: `1px solid ${mode === m ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: mode === m ? 'var(--silver)' : 'var(--text-3)', cursor: 'pointer' }}>
              {m === 'post' ? 'Post 4:5' : 'Story 9:16'}
            </button>
          ))}
          {currentHtml && (
            <>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginLeft: 8 }}>
                <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.max(0.1, +((z === 0 ? fitScale : z) - 0.05).toFixed(2)))}>−</button>
                <span style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', minWidth: 36, textAlign: 'center' }}>{Math.round(displayScale * 100)}%</span>
                <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.min(3, +((z === 0 ? fitScale : z) + 0.05).toFixed(2)))}>+</button>
                <button className="btn btn-ghost btn-xs" onClick={() => setZoom(0)} title="Fit to screen">fit</button>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-xs"
                  style={{ color: 'var(--amber)', borderColor: chatOpen ? 'var(--amber)' : 'var(--border)' }}
                  onClick={() => setChatOpen(c => !c)}
                  title="Open design chatbot to refine this design">
                  💬 Refine
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => navigator.clipboard.writeText(currentHtml).then(() => showToast('HTML copied ✓'))} title="Copy HTML source">
                  ⎘ HTML
                </button>
              </div>
            </>
          )}
        </div>

        {/* Canvas */}
        <div ref={canvasRef}
          style={{ flex: 1, background: '#0D0D0D', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
          {!currentHtml ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-3)', width: '100%' }}>
              {selectedImg ? (
                <>
                  <img src={selectedImg.dataUrl} alt="" style={{ maxHeight: 320, maxWidth: '70%', objectFit: 'contain', opacity: .2, borderRadius: 4 }} />
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>Set direction → Generate</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 40, opacity: .06 }}>◫</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>Select image from filmstrip</div>
                </>
              )}
            </div>
          ) : (
            /* Scale wrapper — reserves only the visual (post-scale) dimensions */
            /* This prevents layout shift because flex sees the scaled size not the raw 1080px */
            <div style={{
              width: Math.round(canvasDims.w * displayScale),
              height: Math.round(canvasDims.h * displayScale),
              flexShrink: 0,
              position: 'relative',
              margin: 'auto',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0,
                transformOrigin: 'top left',
                transform: `scale(${displayScale})`,
                width: canvasDims.w,
                height: canvasDims.h,
                pointerEvents: 'none',
              }}
                dangerouslySetInnerHTML={{ __html: currentHtml }}
              />
            </div>
          )}
          {generating && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(4px)' }}>
              <div style={{ textAlign: 'center' }}>
                <span className="spin" style={{ width: 20, height: 20, borderWidth: 2, display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 11, color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>{genStep}</div>
              </div>
            </div>
          )}
        </div>

        {/* Chat panel */}
        {chatOpen && currentHtml && (
          <div style={{ flexShrink: 0, background: '#080808', borderTop: '1px solid var(--border)', height: 200, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--amber)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', flex: 1 }}>Design Chatbot — describe a change</span>
              <button onClick={() => { setChatOpen(false); setChatHistory([]) }} style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 11 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {chatHistory.length === 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                  Try: "make the text larger" · "move copy to bottom" · "darken the overlay" · "use serif font" · "add a thin white border"
                </div>
              )}
              {chatHistory.map((m, i) => (
                <div key={i} style={{ fontSize: 11, color: m.role === 'user' ? 'var(--silver)' : 'var(--text-2)', fontFamily: m.role === 'user' ? 'var(--font-mono)' : 'var(--font-body)', padding: m.role === 'user' ? '4px 8px' : '0', background: m.role === 'user' ? 'var(--surface)' : 'none', borderRadius: 3, alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {m.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder="Describe a change… (Enter to send)"
                disabled={chatting}
                style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text)', fontSize: 11, padding: '6px 10px', fontFamily: 'var(--font-body)', outline: 'none' }}
              />
              <button className="btn btn-ghost btn-sm" onClick={sendChat} disabled={chatting || !chatInput.trim()}>
                {chatting ? <span className="spin" /> : '→'}
              </button>
            </div>
          </div>
        )}

        {/* Filmstrip */}
        <div style={{ flexShrink: 0, background: '#050505', borderTop: '2px solid #1A1A1A', minHeight: filmSize + 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '5px 12px', gap: 8, borderBottom: '1px solid #1A1A1A' }}>
            <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase' }}>
              {state.images.length} image{state.images.length !== 1 ? 's' : ''}
            </span>
            {selectedImg && <span style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {selectedImg.name}</span>}
            <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginLeft: 'auto' }}>
              <button onClick={() => setFilmSize(s => Math.max(48, s - 16))} style={{ width: 20, height: 20, background: 'none', border: '1px solid #2A2A2A', borderRadius: 2, color: '#666', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
              <span style={{ fontSize: 8, color: '#555', fontFamily: 'var(--font-mono)', minWidth: 24, textAlign: 'center' }}>{filmSize}</span>
              <button onClick={() => setFilmSize(s => Math.min(160, s + 16))} style={{ width: 20, height: 20, background: 'none', border: '1px solid #2A2A2A', borderRadius: 2, color: '#666', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
            </div>
          </div>
          <div ref={filmRef} style={{ display: 'flex', gap: 0, overflowX: 'auto', padding: '6px 12px', height: filmSize + 24, alignItems: 'center', scrollbarWidth: 'thin', scrollbarColor: '#2A2A2A transparent' }}>
            {state.images.length === 0 ? (
              <div style={{ fontSize: 10, color: '#333', fontFamily: 'var(--font-mono)', paddingLeft: 8 }}>Upload images to begin</div>
            ) : (() => {
              const groups = [
                { label: 'Portrait',  images: state.images.filter(i => (i.orientation || 'portrait') === 'portrait') },
                { label: 'Landscape', images: state.images.filter(i => i.orientation === 'landscape') },
                { label: 'Square',    images: state.images.filter(i => i.orientation === 'square') },
              ].filter(g => g.images.length > 0)
              return groups.map((group, gi) => (
                <div key={group.label} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)', fontSize: 7, color: '#333', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', paddingRight: 4, paddingLeft: gi > 0 ? 12 : 0, flexShrink: 0, userSelect: 'none' }}>
                    {group.label} {group.images.length}
                  </div>
                  <div style={{ width: 1, height: filmSize * 0.7, background: '#1E1E1E', flexShrink: 0, marginRight: 6 }} />
                  {group.images.map(img => {
                    const isSelected = selectedImg?.id === img.id
                    return (
                      <div key={img.id} data-id={img.id}
                        onClick={() => setSelectedImgId(img.id)}
                        style={{ width: getFrameW(img), height: filmSize, flexShrink: 0, marginRight: 3, borderRadius: 2, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${isSelected ? 'var(--silver)' : 'transparent'}`, position: 'relative', transition: 'border-color .12s', boxShadow: isSelected ? '0 0 10px rgba(200,200,204,.15)' : 'none' }}>
                        <img src={img.dataUrl} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                        {isSelected && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--silver)' }} />}
                        {/* Delete button on hover */}
                        <button
                          onClick={e => deleteImage(img.id, e)}
                          style={{ position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: 'rgba(180,60,60,.9)', border: 'none', color: '#fff', fontSize: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity .15s' }}
                          onMouseEnter={e => e.currentTarget.style.opacity = 1}
                          onMouseLeave={e => e.currentTarget.style.opacity = 0}>✕</button>
                      </div>
                    )
                  })}
                </div>
              ))
            })()}
          </div>
        </div>

        {/* Iterations */}
        {iterations.length > 1 && mode === 'post' && (
          <div style={{ flexShrink: 0, background: '#080808', borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6, letterSpacing: '.1em', textTransform: 'uppercase' }}>Iterations ({iterations.length})</div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {iterations.map((iter, i) => (
                <div key={i} style={{ flexShrink: 0, position: 'relative' }}>
                  <div style={{ width: 40, aspectRatio: '4/5', borderRadius: 2, overflow: 'hidden', cursor: 'pointer', border: `1px solid ${iter.starred ? 'var(--amber)' : 'var(--border)'}` }}
                    onClick={() => { setDesignHtml(iter.html); setZoom(1) }} title={iter.prompt}>
                    <div style={{ transform: `scale(${40/1080})`, transformOrigin: 'top left', width: 1080, height: 1350, pointerEvents: 'none' }}
                      dangerouslySetInnerHTML={{ __html: iter.html }} />
                  </div>
                  <button onClick={() => setIterations(prev => prev.map((it, j) => j === i ? { ...it, starred: !it.starred } : it))}
                    style={{ position: 'absolute', top: 2, left: 2, background: 'none', border: 'none', fontSize: 8, cursor: 'pointer', opacity: iter.starred ? 1 : .4 }}>★</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: CONTROLS ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-raised)' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* Selected image preview */}
          {selectedImg && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ width: 52, height: 52, borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--silver-edge)', flexShrink: 0 }}>
                  <img src={selectedImg.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedImg.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    {selectedImg.width && selectedImg.height ? `${selectedImg.width}×${selectedImg.height}` : ''} · {selectedImg.orientation || ''}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI Copy panel */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <div className="field-label" style={{ flex: 1 }}>Copy & Text</div>
              <button className="btn btn-ghost btn-xs" onClick={() => setCopyPanel(c => !c)}>
                {copyPanel ? '▲' : '▼'}
              </button>
            </div>
            {copyPanel && (
              <>
                <button className="btn btn-ghost btn-sm btn-full" onClick={generateCopy} disabled={generatingCopy || !selectedImg} style={{ marginBottom: 10 }}>
                  {generatingCopy ? <><span className="spin" /> Generating…</> : '✦ Generate Copy from Image'}
                </button>

                {/* Copy fields with lock */}
                {[
                  ['Headline',    'headline', 'The strongest 2-5 words'],
                  ['Subheadline', 'sub',      'One line of context'],
                  ['Tagline',     'tagline',  'Studio voice — optional'],
                  ['CTA',         'cta',      'Invitation to work together'],
                ].map(([label, key, ph]) => (
                  <div key={key} style={{ marginBottom: 6, display: 'flex', gap: 5, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 8, color: lockedFields[key] ? 'var(--silver)' : 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {label}
                        {lockedFields[key] && <span style={{ fontSize: 7, color: 'var(--silver)', opacity: .7 }}>locked</span>}
                      </div>
                      <input className="input" value={copy[key] || ''} onChange={e => setCopy(c => ({ ...c, [key]: e.target.value }))}
                        placeholder={lockedFields[key] ? '(locked)' : ph}
                        disabled={lockedFields[key]}
                        style={{ fontSize: 11, padding: '5px 8px', opacity: lockedFields[key] ? .6 : 1 }} />
                    </div>
                    {/* Lock toggle */}
                    <button
                      onClick={() => setLockedFields(l => ({ ...l, [key]: !l[key] }))}
                      title={lockedFields[key] ? 'Unlock — will regenerate' : 'Lock — will preserve on next generate'}
                      style={{ width: 24, height: 24, marginTop: 14, flexShrink: 0, background: lockedFields[key] ? 'var(--silver-ghost)' : 'none', border: `1px solid ${lockedFields[key] ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: lockedFields[key] ? 'var(--silver)' : 'var(--text-3)', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {lockedFields[key] ? '🔒' : '🔓'}
                    </button>
                  </div>
                ))}

                {/* Website field */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>Website</div>
                  <input className="input" value={copy.website || ''} onChange={e => setCopy(c => ({ ...c, website: e.target.value }))}
                    placeholder="www.kshetejsareen.com"
                    style={{ fontSize: 11, padding: '5px 8px' }} />
                  <div style={{ fontSize: 8, color: 'var(--text-3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>Leave blank to use default KSS website</div>
                </div>

                {(copy.headline || copy.sub) && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => { setCopy({ headline: '', sub: '', tagline: '', cta: '', website: '' }); setLockedFields({ headline: false, sub: false, tagline: false, cta: false }) }}>Clear all</button>
                    <button className="btn btn-ghost btn-xs" onClick={() => setLockedFields({ headline: false, sub: false, tagline: false, cta: false })}>Unlock all</button>
                  </div>
                )}
              </>
            )}
            {!copyPanel && (copy.headline || copy.sub) && (
              <div style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                "{copy.headline || copy.sub}"
                {Object.values(lockedFields).some(Boolean) && <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>· {Object.values(lockedFields).filter(Boolean).length} locked</span>}
              </div>
            )}
          </div>

          {/* Reference image */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div className="field-label" style={{ marginBottom: 4 }}>Reference <span style={{ color: 'var(--text-3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></div>
            <div style={{ fontSize: 9, color: 'var(--text-3)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>Upload a design — Claude matches its style</div>
            {refImgDataUrl ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={refImgDataUrl} alt="ref" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 'var(--r)', border: '1px solid var(--silver-edge)', display: 'block' }} />
                <button onClick={() => setRefImgDataUrl(null)} style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: '#1A1A1A', border: '1px solid var(--border-2)', color: 'var(--text-3)', cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              </div>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: '1px dashed var(--border-2)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                <input type="file" accept="image/*" onChange={handleRefImg} style={{ display: 'none' }} />
                ↑ Upload reference
              </label>
            )}
          </div>

          {/* Style direction */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div className="field-label" style={{ flex: 1 }}>Directorial Intent</div>
              {stylePrompt && <button className="btn btn-ghost btn-xs" onClick={() => setStylePrompt('')}>clear</button>}
            </div>
            <textarea className="textarea" value={stylePrompt} onChange={e => setStylePrompt(e.target.value)}
              rows={2} placeholder="Describe composition and feeling only — colours, fonts and text placement come from the image itself"
              style={{ fontSize: 11, resize: 'none', marginBottom: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                ['Subject dominant',    'The subject fills the frame. Everything else — type, space, tone — bows to it. Minimal interference.'],
                ['Negative space led',  'Find the open space in the image. Build the entire composition around it. The subject and text breathe together.'],
                ['Graphic tension',     'Create visual tension between the image and the type. Contrast of scale, weight or placement. Uncomfortable in the right way.'],
                ['Editorial stillness', 'Nothing moves, nothing shouts. The design should feel like a magazine spread that stopped time.'],
                ['Layered depth',       'Multiple visual planes — foreground, subject, background. Typography exists in a separate plane, not on top of the image.'],
                ['Cinematic',           'Think about what happens before and after the frame. The design should feel like a still from a film — incomplete, evocative.'],
              ].map(([label, p]) => (
                <button key={label} onClick={() => setStylePrompt(stylePrompt === p ? '' : p)}
                  style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, background: stylePrompt === p ? 'var(--silver-ghost)' : 'none', border: `1px solid ${stylePrompt === p ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: stylePrompt === p ? 'var(--silver)' : 'var(--text-2)', cursor: 'pointer', lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 600, marginBottom: 1 }}>{label}</div>
                  <div style={{ fontSize: 9, opacity: .6, lineHeight: 1.3 }}>{p.slice(0, 60)}…</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Actions — sticky bottom */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button className="plan-btn" onClick={generate} disabled={generating || !selectedImg}>
            {generating ? <><span className="spin" /> {genStep || 'Generating…'}</> : `✦ Generate ${mode === 'story' ? 'Story' : 'Post'}`}
          </button>
          {currentHtml && (
            <button className="btn btn-ghost btn-full" disabled={exporting}
              onClick={async () => {
                setExporting(true)
                try {
                  const handle = state.settings.handle?.replace('@','') || 'KSS'
                  await exportPng(currentHtml, canvasDims.w, canvasDims.h, `${handle}-${mode}-${Date.now()}.png`)
                  showToast('PNG exported ✓')
                } catch(e) { showToast('Export failed: ' + e.message) }
                finally { setExporting(false) }
              }}>
              {exporting ? <><span className="spin" /> Exporting…</> : '↓ Export PNG'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
