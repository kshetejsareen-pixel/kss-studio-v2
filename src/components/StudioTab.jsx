import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore, claudeVision, claudeCall, M_SONNET, M_HAIKU, exportPng, readFileAsDataUrl, resizeImage, extractBase64, PROXY } from '../store.jsx'

// ── SYSTEM PROMPTS ────────────────────────────────────────

const VISION_ANALYSIS_SYSTEM = `You are a visual composition analyst. Analyse the provided image and return a JSON object:
{
  "focalPoint": "where the main subject sits (e.g. center, lower-third, left)",
  "negativeSpace": "where the open/empty areas are (e.g. top-right corner, upper third)",
  "dominantTones": "light/dark/mid, and which areas (e.g. dark bottom, light sky top)",
  "suggestedTextZone": "best area for text overlay without obscuring subject",
  "mood": "one word mood (cinematic, warm, moody, clean, dramatic etc)",
  "colorPalette": ["#hex1","#hex2","#hex3"]
}
Return ONLY valid JSON, nothing else.`

const POST_SYSTEM = (handle, context, analysis, copy) => `You are a luxury creative director generating Instagram post HTML for ${handle}.
Context: ${context || 'Luxury commercial photography studio'}
${analysis ? `Image analysis: focal point at ${analysis.focalPoint}, negative space at ${analysis.negativeSpace}, dominant tones: ${analysis.dominantTones}. Place text in the ${analysis.suggestedTextZone}.` : ''}
${copy?.headline ? `Use this copy — Headline: "${copy.headline}"${copy.sub ? `, Subheadline: "${copy.sub}"` : ''}${copy.tagline ? `, Tagline: "${copy.tagline}"` : ''}` : ''}

Rules:
- Inline styles only — no external CSS files
- Use <style> tag only for @import Google Fonts
- Div must be exactly the specified dimensions with position: relative; overflow: hidden
- Use src="[IMAGE_SRC]" for img tags, url('[IMAGE_SRC]') for CSS backgrounds
- The image MUST be visible — full bleed or dominant hero
- NEVER use a black rectangle as background unless style requires it
- Return ONLY the HTML div, no explanation`

const STORY_SYSTEM = (handle, context, analysis, copy) => `You are a luxury creative director generating Instagram Story HTML for ${handle}.
Context: ${context || 'Luxury commercial photography studio'}
${analysis ? `Image analysis: place text in ${analysis.suggestedTextZone}, tones: ${analysis.dominantTones}` : ''}
${copy?.headline ? `Copy — Headline: "${copy.headline}"${copy.sub ? `, Sub: "${copy.sub}"` : ''}` : ''}
Rules: Inline styles only. Div exactly 1080×1920px. Use src="[IMAGE_SRC]". Image visible. Return ONLY HTML.`

const COPY_SYSTEM = (handle, context) => `You are a luxury brand copywriter for ${handle}, a high-end commercial photography studio.
Context: ${context || 'Luxury photography'}
Rules:
- Write minimal, editorial copy — luxury brands say less, mean more
- No clichés: "capturing moments", "timeless", "bespoke", "stunning"
- Return JSON only:
{
  "headline": "short punchy headline (2-6 words max)",
  "sub": "optional subheadline (max 8 words, or null)",
  "tagline": "optional one-line brand tagline (or null)",
  "cta": "optional call to action (or null)"
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
  const [copy, setCopy]                   = useState({ headline: '', sub: '', tagline: '', cta: '' })
  const [generatingCopy, setGeneratingCopy] = useState(false)

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
    const h = (e) => { e.preventDefault(); setZoom(z => Math.max(0.1, Math.min(4, z + (e.deltaY < 0 ? 0.1 : -0.1)))) }
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
      const system = COPY_SYSTEM(state.settings.handle || '@kshetejsareenstudios', state.globalContext)
      const prompt = `Generate luxury copy for this image. Brand: ${state.globalContext || 'luxury photography studio'}. Look at what's in the image — the copy should feel specific to it, not generic.`
      const raw = await claudeVision(key, system, prompt, selectedImg.dataUrl, M_HAIKU, 300)
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        setCopy({ headline: parsed.headline || '', sub: parsed.sub || '', tagline: parsed.tagline || '', cta: parsed.cta || '' })
        showToast('Copy generated ✓')
      }
    } catch(e) { showToast('Copy generation failed: ' + e.message) }
    finally { setGeneratingCopy(false) }
  }, [state, selectedImg, showToast])

  // ── Generate design ──
  const generate = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    if (!selectedImg) { showToast('Select an image first'); return }
    setGenerating(true); setZoom(1); setChatHistory([])

    const isStory = mode === 'story'
    const w = 1080, h = isStory ? 1920 : 1350
    const handle = state.settings.handle || '@kshetejsareenstudios'
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
      const system = isStory ? STORY_SYSTEM(handle, context, analysis, hasCopy ? copy : null)
                              : POST_SYSTEM(handle, context, analysis, hasCopy ? copy : null)

      const refNote = refImgDataUrl ? '\nReference image provided — match its layout, typography, colour palette.' : ''
      const prompt = `Generate a ${isStory ? '1080×1920 Instagram Story' : '1080×1350 Instagram Post'} design.
Handle: ${handle}
Context: ${context || 'Luxury photography studio'}
${stylePrompt ? `Style: ${stylePrompt}` : `Style: ${analysis?.mood || 'editorial'} luxury — image dominant, considered typography`}${refNote}
CRITICAL: Use src="[IMAGE_SRC]" for the image. Div must be exactly ${w}px × ${h}px.`

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
  const fitScale     = Math.min((canvasSize.h - 40) / canvasDims.h, (canvasSize.w - 40) / canvasDims.w) * 0.95
  const displayScale = Math.max(0.05, fitScale * zoom)
  const getFrameW    = (img) => Math.round(filmSize * (img.width && img.height ? img.width / img.height : 0.75))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 288px', gap: 0, height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: CANVAS + FILMSTRIP ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
          {['post', 'story'].map(m => (
            <button key={m} onClick={() => { setMode(m); setZoom(1) }}
              style={{ padding: '5px 14px', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', background: mode === m ? 'var(--silver-ghost)' : 'none', border: `1px solid ${mode === m ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: mode === m ? 'var(--silver)' : 'var(--text-3)', cursor: 'pointer' }}>
              {m === 'post' ? 'Post 4:5' : 'Story 9:16'}
            </button>
          ))}
          {currentHtml && (
            <>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginLeft: 8 }}>
                <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.max(0.1, +(z - 0.1).toFixed(1)))}>−</button>
                <span style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', minWidth: 36, textAlign: 'center' }}>{Math.round(displayScale * 100)}%</span>
                <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.min(4, +(z + 0.1).toFixed(1)))}>+</button>
                <button className="btn btn-ghost btn-xs" onClick={() => setZoom(1)}>fit</button>
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
        <div ref={canvasRef} style={{ flex: 1, background: '#0A0A0A', overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, position: 'relative' }}>
          {!currentHtml ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-3)', width: '100%', minHeight: 400 }}>
              {selectedImg ? (
                <>
                  <img src={selectedImg.dataUrl} alt="" style={{ maxHeight: 360, maxWidth: '80%', objectFit: 'contain', opacity: .25, borderRadius: 4 }} />
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>Set style direction → Generate</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 40, opacity: .08 }}>◫</div>
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>Select image from filmstrip below</div>
                </>
              )}
            </div>
          ) : (
            <div style={{ transformOrigin: 'top center', transform: `scale(${displayScale})`, width: canvasDims.w, height: canvasDims.h, flexShrink: 0 }}
              dangerouslySetInnerHTML={{ __html: currentHtml }} />
          )}
          {generating && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }}>
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
              <div className="field-label" style={{ flex: 1 }}>AI Copy</div>
              <button className="btn btn-ghost btn-xs" onClick={() => setCopyPanel(c => !c)}>
                {copyPanel ? '▲' : '▼'}
              </button>
            </div>
            {copyPanel && (
              <>
                <button className="btn btn-ghost btn-sm btn-full" onClick={generateCopy} disabled={generatingCopy || !selectedImg} style={{ marginBottom: 8 }}>
                  {generatingCopy ? <><span className="spin" /> Generating…</> : '✦ Generate Copy from Image'}
                </button>
                {[
                  ['Headline', 'headline', 'e.g. "Where light lives"'],
                  ['Subheadline', 'sub', 'e.g. "The Leela, Gurgaon"'],
                  ['Tagline', 'tagline', 'e.g. "Luxury is a feeling."'],
                  ['CTA', 'cta', 'e.g. "Inquire now"'],
                ].map(([label, key, ph]) => (
                  <div key={key} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
                    <input className="input" value={copy[key]} onChange={e => setCopy(c => ({ ...c, [key]: e.target.value }))}
                      placeholder={ph} style={{ fontSize: 11, padding: '5px 8px' }} />
                  </div>
                ))}
                {(copy.headline || copy.sub) && (
                  <button className="btn btn-ghost btn-xs" onClick={() => setCopy({ headline: '', sub: '', tagline: '', cta: '' })}>Clear copy</button>
                )}
              </>
            )}
            {!copyPanel && (copy.headline || copy.sub) && (
              <div style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                "{copy.headline || copy.sub}"
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
            <div className="field-label" style={{ marginBottom: 6 }}>Style Direction</div>
            <textarea className="textarea" value={stylePrompt} onChange={e => setStylePrompt(e.target.value)}
              rows={2} placeholder="e.g. Dark moody, silver type, Syne&#10;Or leave blank — AI decides from image mood"
              style={{ fontSize: 11, resize: 'none', marginBottom: 8 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {[
                ['Dark editorial', 'Dark moody overlay, silver/white typography, Syne font, minimal text, handle bottom right'],
                ['Clean minimal',  'Clean white overlay bottom, black sans-serif, image dominant, subtle branding'],
                ['Full bleed',     'Full bleed image, no overlay, handle small white mono font bottom right'],
                ['Split layout',   'Image left 60%, text right 40% dark background, editorial typography'],
                ['Film grain',     'Warm film grain, amber tones, serif typography, cinematic letterboxing'],
              ].map(([label, p]) => (
                <button key={label} onClick={() => setStylePrompt(stylePrompt === p ? '' : p)}
                  style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, background: stylePrompt === p ? 'var(--silver-ghost)' : 'none', border: `1px solid ${stylePrompt === p ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: stylePrompt === p ? 'var(--silver)' : 'var(--text-2)', cursor: 'pointer' }}>
                  {label}
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
