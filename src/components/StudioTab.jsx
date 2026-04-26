import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore, claudeVision, M_SONNET, exportPng, readFileAsDataUrl, resizeImage, extractBase64, PROXY } from '../store.jsx'

const POST_SYSTEM = (handle, context) => `You are a luxury creative director generating Instagram post HTML for ${handle}.
Context: ${context || 'Luxury commercial photography studio'}

Generate a single self-contained HTML div styled for Instagram. Rules:
- Inline styles only — no external CSS files
- Use <style> tag only for @import Google Fonts
- Div must be exactly the specified dimensions with overflow: hidden
- The subject image will be injected as a base64 data URL — use src="[IMAGE_SRC]" for <img> tags, or url('[IMAGE_SRC]') for CSS backgrounds
- NEVER use black as the primary background unless the style explicitly requires it
- The image must be VISIBLE and DOMINANT — it should cover most of the design
- Return ONLY the HTML div, no explanation, no markdown`

const STORY_SYSTEM = (handle, context) => `You are a luxury creative director generating Instagram Story HTML for ${handle}.
Context: ${context || 'Luxury commercial photography studio'}

Generate a self-contained HTML div for 1080×1920px. Rules:
- Inline styles only
- Div must be exactly 1080×1920px with overflow: hidden
- Use src="[IMAGE_SRC]" for img tags, url('[IMAGE_SRC]') for CSS backgrounds
- The image must be visible and fill most of the frame
- Return ONLY the HTML div`

export default function StudioTab({ showToast }) {
  const { state } = useStore()
  const [mode, setMode]                   = useState('post')
  const [selectedImgId, setSelectedImgId] = useState(null)
  const [refImgDataUrl, setRefImgDataUrl] = useState(null)
  const [stylePrompt, setStylePrompt]     = useState('')
  const [generating, setGenerating]       = useState(false)
  const [exporting, setExporting]         = useState(false)
  const [designHtml, setDesignHtml]       = useState('')
  const [storyHtml, setStoryHtml]         = useState('')
  const [iterations, setIterations]       = useState([])
  const [zoom, setZoom]                   = useState(1)
  const [filmSize, setFilmSize]           = useState(80) // filmstrip frame height px
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 480 })
  const canvasRef  = useRef(null)
  const filmRef    = useRef(null)

  const selectedImg = state.images.find(i => i.id === selectedImgId) || state.images[0] || null

  // Measure actual canvas container size
  useEffect(() => {
    if (!canvasRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) setCanvasSize({ w: width, h: height })
      }
    })
    ro.observe(canvasRef.current)
    return () => ro.disconnect()
  }, [])

  // Zoom via wheel on canvas
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      setZoom(z => Math.max(0.1, Math.min(4, z + (e.deltaY < 0 ? 0.1 : -0.1))))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [designHtml, storyHtml])

  // Handle reference image upload
  const handleRefImg = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const dataUrl = await readFileAsDataUrl(file)
    setRefImgDataUrl(dataUrl)
    showToast('Reference image loaded ✓')
  }

  // Scroll filmstrip to selected image
  useEffect(() => {
    if (!selectedImg || !filmRef.current) return
    const el = filmRef.current.querySelector(`[data-id="${selectedImg.id}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedImg?.id])

  const generate = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add Anthropic API key in Settings'); return }
    if (!selectedImg) { showToast('Select an image first'); return }
    setGenerating(true); setZoom(1)

    const isStory = mode === 'story'
    const w = 1080, h = isStory ? 1920 : 1350
    const handle = state.settings.handle || '@kshetejsareenstudios'
    const context = state.globalContext
    const system = isStory ? STORY_SYSTEM(handle, context) : POST_SYSTEM(handle, context)

    const refNote = refImgDataUrl
      ? '\nReference image provided — match its layout, typography style, colour palette and aesthetic. Adapt for this subject.'
      : ''

    const prompt = `Generate a ${isStory ? '1080×1920 Instagram Story' : '1080×1350 Instagram Post'} design.
Handle: ${handle}
Context: ${context || 'Luxury photography studio'}
${stylePrompt ? `Style direction: ${stylePrompt}` : 'Style: Editorial luxury — clean, confident, magazine-quality. Image should be full-bleed or dominant.'}${refNote}

CRITICAL: 
- Use src="[IMAGE_SRC]" for the subject image (it will be replaced with the actual image)
- The image MUST be visible in the final design — full bleed background or hero element
- Div must be exactly ${w}px × ${h}px with position: relative; overflow: hidden`

    try {
      let raw
      if (refImgDataUrl) {
        const resizedSubject = await resizeImage(selectedImg.dataUrl, 800)
        const resizedRef     = await resizeImage(refImgDataUrl, 600)
        const bs = extractBase64(resizedSubject)
        const br = extractBase64(resizedRef)
        const r = await fetch(PROXY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: M_SONNET, max_tokens: 4000, system,
            messages: [{ role: 'user', content: [
              { type: 'text', text: 'Subject image (use as hero/background):' },
              { type: 'image', source: { type: 'base64', media_type: bs.mediaType, data: bs.data } },
              { type: 'text', text: 'Reference image (match this style/layout):' },
              { type: 'image', source: { type: 'base64', media_type: br.mediaType, data: br.data } },
              { type: 'text', text: prompt },
            ]}],
          }),
        })
        if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error?.message || `HTTP ${r.status}`) }
        const d = await r.json()
        raw = d.content?.find(b => b.type === 'text')?.text
      } else {
        raw = await claudeVision(key, system, prompt, selectedImg.dataUrl, M_SONNET, 4000)
      }

      if (!raw) throw new Error('Empty response')
      let html = raw.replace(/```html[\s\S]*?```/g, m => m.replace(/```html\n?/, '').replace(/\n?```/, ''))
                    .replace(/```/g, '').trim()

      // Comprehensive image injection — Claude uses many different placeholder patterns
      const imgData = selectedImg.dataUrl
      html = html
        .replace(/\[IMAGE_SRC\]/g, imgData)
        .replace(/\[SUBJECT_IMAGE\]/g, imgData)
        .replace(/src="placeholder[^"]*"/g, `src="${imgData}"`)
        .replace(/src='placeholder[^']*'/g, `src='${imgData}'`)
        .replace(/url\(['"]?placeholder[^'")\s]*['"]?\)/g, `url('${imgData}')`)
        .replace(/url\(['"]?\[IMAGE[^\]]*\]['"]?\)/g, `url('${imgData}')`)
        .replace(/url\(['"]?YOUR_IMAGE_HERE['"]?\)/g, `url('${imgData}')`)
        .replace(/url\(['"]?image\.jpg['"]?\)/g, `url('${imgData}')`)
        .replace(/url\(['"]?photo\.jpg['"]?\)/g, `url('${imgData}')`)
        .replace(/url\(['"]?background\.jpg['"]?\)/g, `url('${imgData}')`)

      if (isStory) {
        setStoryHtml(html)
      } else {
        setDesignHtml(html)
        setIterations(prev => [{ html, prompt: stylePrompt || 'default', ts: Date.now() }, ...prev].slice(0, 8))
      }
      showToast('Design generated ✓ — scroll to zoom')
    } catch (e) { showToast('Error: ' + e.message); console.error(e) }
    finally { setGenerating(false) }
  }, [state, selectedImg, mode, stylePrompt, refImgDataUrl, showToast])

  const currentHtml  = mode === 'story' ? storyHtml : designHtml
  const canvasDims   = mode === 'story' ? { w: 1080, h: 1920 } : { w: 1080, h: 1350 }
  const fitScale     = Math.min(
    (canvasSize.h - 40) / canvasDims.h,
    (canvasSize.w - 40) / canvasDims.w
  ) * 0.95
  const displayScale = Math.max(0.05, fitScale * zoom)

  // Filmstrip frame width based on height and image orientation
  const getFrameW = (img) => {
    if (!img) return filmSize * 0.75
    const ratio = img.width && img.height ? img.width / img.height : 0.75
    return Math.round(filmSize * ratio)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 288px', gap: 0, height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: CANVAS + FILMSTRIP ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>

        {/* Mode tabs + zoom */}
        <div style={{ display: 'flex', gap: 4, padding: '12px 16px 8px', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
          {['post', 'story'].map(m => (
            <button key={m} onClick={() => { setMode(m); setZoom(1) }}
              style={{ padding: '5px 14px', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', background: mode === m ? 'var(--silver-ghost)' : 'none', border: `1px solid ${mode === m ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: mode === m ? 'var(--silver)' : 'var(--text-3)', cursor: 'pointer' }}>
              {m === 'post' ? 'Post 4:5' : 'Story 9:16'}
            </button>
          ))}
          {currentHtml && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, alignItems: 'center' }}>
              <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.max(0.2, +(z - 0.1).toFixed(1)))}>−</button>
              <span style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', minWidth: 36, textAlign: 'center' }}>{Math.round(displayScale * 100)}%</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.min(4, +(z + 0.1).toFixed(1)))}>+</button>
              <button className="btn btn-ghost btn-xs" onClick={() => setZoom(1)}>fit</button>
            </div>
          )}
        </div>

        {/* Canvas */}
        <div ref={canvasRef} style={{ flex: 1, background: '#0A0A0A', overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20 }}>
          {!currentHtml ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-3)', width: '100%', minHeight: containerH }}>
              {selectedImg ? (
                <>
                  <img src={selectedImg.dataUrl} alt="" style={{ maxHeight: containerH - 60, maxWidth: '80%', objectFit: 'contain', opacity: .3, borderRadius: 4 }} />
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>Add style direction → Generate</div>
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
        </div>

        {/* ── FILMSTRIP ── */}
        <div style={{ flexShrink: 0, background: '#050505', borderTop: '2px solid #1A1A1A', minHeight: filmSize + 48 }}>
          {/* Filmstrip toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', gap: 8, borderBottom: '1px solid #1A1A1A' }}>
            <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase' }}>
              {state.images.length} image{state.images.length !== 1 ? 's' : ''}
            </span>
            {selectedImg && (
              <span style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                · {selectedImg.name}
              </span>
            )}
            <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginLeft: 'auto' }}>
              <button
                onClick={() => setFilmSize(s => Math.max(48, s - 16))}
                style={{ width: 20, height: 20, background: 'none', border: '1px solid #2A2A2A', borderRadius: 2, color: '#666', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>−</button>
              <span style={{ fontSize: 8, color: '#555', fontFamily: 'var(--font-mono)', minWidth: 24, textAlign: 'center' }}>{filmSize}px</span>
              <button
                onClick={() => setFilmSize(s => Math.min(160, s + 16))}
                style={{ width: 20, height: 20, background: 'none', border: '1px solid #2A2A2A', borderRadius: 2, color: '#666', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>+</button>
            </div>
          </div>

          {/* Filmstrip frames */}
          <div ref={filmRef}
            style={{ display: 'flex', gap: 3, overflowX: 'auto', overflowY: 'hidden', padding: '8px 12px', height: filmSize + 24, alignItems: 'center', scrollbarWidth: 'thin', scrollbarColor: '#2A2A2A transparent' }}>
            {state.images.length === 0 ? (
              <div style={{ fontSize: 10, color: '#333', fontFamily: 'var(--font-mono)', paddingLeft: 8 }}>Upload images to begin</div>
            ) : state.images.map(img => {
              const isSelected = selectedImg?.id === img.id
              const frameW = getFrameW(img)
              return (
                <div key={img.id} data-id={img.id}
                  onClick={() => setSelectedImgId(img.id)}
                  style={{
                    width: frameW, height: filmSize, flexShrink: 0,
                    borderRadius: 2, overflow: 'hidden', cursor: 'pointer',
                    border: `2px solid ${isSelected ? 'var(--silver)' : 'transparent'}`,
                    outline: isSelected ? '1px solid rgba(200,200,204,.2)' : 'none',
                    outlineOffset: 2,
                    position: 'relative',
                    transition: 'border-color .12s',
                    boxShadow: isSelected ? '0 0 12px rgba(200,200,204,.15)' : 'none',
                  }}>
                  <img src={img.dataUrl} alt={img.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                  {isSelected && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--silver)' }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Iterations strip */}
        {iterations.length > 1 && mode === 'post' && (
          <div style={{ flexShrink: 0, background: '#080808', borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6, letterSpacing: '.1em', textTransform: 'uppercase' }}>
              Previous iterations ({iterations.length - 1})
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {iterations.slice(1).map((iter, i) => (
                <div key={i}
                  style={{ width: 40, aspectRatio: '4/5', borderRadius: 2, overflow: 'hidden', cursor: 'pointer', border: '1px solid var(--border)', flexShrink: 0, position: 'relative' }}
                  onClick={() => { setDesignHtml(iter.html); setZoom(1) }} title={iter.prompt}>
                  <div style={{ transform: `scale(${40/1080})`, transformOrigin: 'top left', width: 1080, height: 1350, pointerEvents: 'none' }}
                    dangerouslySetInnerHTML={{ __html: iter.html }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: CONTROLS ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto', background: 'var(--bg-raised)' }}>

        {/* Selected image preview */}
        {selectedImg && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
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

        {/* Reference image */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div className="field-label" style={{ marginBottom: 4 }}>Reference <span style={{ color: 'var(--text-3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></div>
          <div style={{ fontSize: 9, color: 'var(--text-3)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>Upload a design — Claude matches its style</div>
          {refImgDataUrl ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img src={refImgDataUrl} alt="ref" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 'var(--r)', border: '1px solid var(--silver-edge)', display: 'block' }} />
              <button onClick={() => setRefImgDataUrl(null)}
                style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: '#1A1A1A', border: '1px solid var(--border-2)', color: 'var(--text-3)', cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: '1px dashed var(--border-2)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              <input type="file" accept="image/*" onChange={handleRefImg} style={{ display: 'none' }} />
              ↑ Upload reference
            </label>
          )}
        </div>

        {/* Style direction */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flex: 1 }}>
          <div className="field-label" style={{ marginBottom: 6 }}>Style Direction</div>
          <textarea className="textarea" value={stylePrompt} onChange={e => setStylePrompt(e.target.value)}
            rows={3} placeholder="e.g. Dark moody, silver type, Syne&#10;Or leave blank — AI decides"
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
                style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, background: stylePrompt === p ? 'var(--silver-ghost)' : 'none', border: `1px solid ${stylePrompt === p ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: stylePrompt === p ? 'var(--silver)' : 'var(--text-2)', cursor: 'pointer', transition: 'all .15s' }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          <button className="plan-btn" onClick={generate} disabled={generating || !selectedImg}>
            {generating ? <><span className="spin" /> Generating…</> : `✦ Generate ${mode === 'story' ? 'Story' : 'Post'}`}
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
