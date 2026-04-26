import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore, claudeVision, M_SONNET, exportPng, readFileAsDataUrl, resizeImage, extractBase64, PROXY } from '../store.jsx'

const POST_SYSTEM = (handle, context) => `You are a luxury creative director generating Instagram post HTML for ${handle}.
Context: ${context || 'Luxury commercial photography studio'}
Generate a single self-contained HTML div styled for Instagram. Rules:
- Inline styles only — no external CSS files
- Use <style> tag only for @import Google Fonts
- Div must be exactly the specified dimensions
- Use the subject image as background or hero element
- Return ONLY the HTML, no explanation`

const STORY_SYSTEM = (handle, context) => `You are a luxury creative director generating Instagram Story HTML for ${handle}.
Context: ${context || 'Luxury commercial photography studio'}
Generate a self-contained HTML div for 1080×1920px. Rules:
- Inline styles only
- Div must be exactly 1080×1920px
- Use subject image as background
- Return ONLY the HTML`

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
  const canvasRef = useRef(null)

  const selectedImg = state.images.find(i => i.id === selectedImgId) || state.images[0] || null

  // Zoom via wheel
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      setZoom(z => Math.max(0.2, Math.min(4, z + (e.deltaY < 0 ? 0.1 : -0.1))))
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
${stylePrompt ? `Style direction: ${stylePrompt}` : 'Style: Editorial luxury — clean, confident, magazine-quality'}${refNote}
The subject image is provided. Use it as the hero/background. Div must be exactly ${w}px × ${h}px.`

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
      const html = raw.replace(/```html|```/g, '').trim()
        .replace(/\[IMAGE_SRC\]/g, selectedImg.dataUrl)
        .replace(/src="placeholder"/g, `src="${selectedImg.dataUrl}"`)

      if (isStory) {
        setStoryHtml(html)
      } else {
        setDesignHtml(html)
        setIterations(prev => [{ html, prompt: stylePrompt || 'default', ts: Date.now() }, ...prev].slice(0, 5))
      }
      showToast('Design generated ✓ — scroll to zoom')
    } catch (e) { showToast('Error: ' + e.message); console.error(e) }
    finally { setGenerating(false) }
  }, [state, selectedImg, mode, stylePrompt, refImgDataUrl, showToast])

  const currentHtml = mode === 'story' ? storyHtml : designHtml
  const canvasDims  = mode === 'story' ? { w: 1080, h: 1920 } : { w: 1080, h: 1350 }
  const containerH  = 520
  const containerW  = 340
  const fitScale    = Math.min(containerH / canvasDims.h, containerW / canvasDims.w) * 0.92
  const displayScale = fitScale * zoom

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, padding: 24, height: '100%', overflow: 'auto' }}>

      {/* CANVAS */}
      <div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, alignItems: 'center' }}>
          {['post', 'story'].map(m => (
            <button key={m} onClick={() => { setMode(m); setZoom(1) }}
              style={{ padding: '6px 16px', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', background: mode === m ? 'var(--silver-ghost)' : 'none', border: `1px solid ${mode === m ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: mode === m ? 'var(--silver)' : 'var(--text-3)', cursor: 'pointer' }}>
              {m === 'post' ? 'Post 4:5' : 'Story 9:16'}
            </button>
          ))}
          {currentHtml && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>zoom</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.max(0.2, z - 0.1))}>−</button>
              <span style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', minWidth: 32, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.min(4, z + 0.1))}>+</button>
              <button className="btn btn-ghost btn-xs" onClick={() => setZoom(1)}>fit</button>
            </div>
          )}
        </div>

        <div ref={canvasRef}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-2)', overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', minHeight: containerH, padding: 20 }}>
          {!currentHtml ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: containerH - 40, gap: 10, color: 'var(--text-3)', width: '100%' }}>
              <div style={{ fontSize: 36, opacity: .12 }}>◫</div>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>Select image · add style direction · Generate</div>
            </div>
          ) : (
            <div style={{ transformOrigin: 'top center', transform: `scale(${displayScale})`, width: canvasDims.w, height: canvasDims.h, flexShrink: 0 }}
              dangerouslySetInnerHTML={{ __html: currentHtml }} />
          )}
        </div>

        {iterations.length > 1 && mode === 'post' && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6, letterSpacing: '.1em', textTransform: 'uppercase' }}>Previous iterations</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {iterations.slice(1).map((iter, i) => (
                <div key={i}
                  style={{ width: 48, aspectRatio: '4/5', borderRadius: 2, overflow: 'hidden', cursor: 'pointer', border: '1px solid var(--border)', flexShrink: 0, position: 'relative' }}
                  onClick={() => { setDesignHtml(iter.html); setZoom(1) }} title={iter.prompt}>
                  <div style={{ transform: `scale(${48/1080})`, transformOrigin: 'top left', width: 1080, height: 1350, pointerEvents: 'none' }}
                    dangerouslySetInnerHTML={{ __html: iter.html }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* CONTROLS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        <div className="card" style={{ padding: 12 }}>
          <div className="field-label" style={{ marginBottom: 8 }}>Subject Image</div>
          {state.images.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>No images loaded</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
              {state.images.map(img => (
                <div key={img.id} onClick={() => setSelectedImgId(img.id)}
                  style={{ width: 38, height: 38, borderRadius: 2, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${selectedImg?.id === img.id ? 'var(--silver)' : 'transparent'}`, flexShrink: 0, transition: 'border-color .15s' }}>
                  <img src={img.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div className="field-label" style={{ marginBottom: 4 }}>Reference Image <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(optional)</span></div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 8 }}>Upload a design you love — Claude matches its style</div>
          {refImgDataUrl ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img src={refImgDataUrl} alt="ref" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--silver-edge)', display: 'block' }} />
              <button onClick={() => setRefImgDataUrl(null)}
                style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', background: 'var(--surface-3)', border: '1px solid var(--border-2)', color: 'var(--text-3)', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px dashed var(--border-2)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              <input type="file" accept="image/*" onChange={handleRefImg} style={{ display: 'none' }} />
              ↑ Upload reference
            </label>
          )}
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div className="field-label" style={{ marginBottom: 6 }}>Style Direction</div>
          <textarea className="textarea" value={stylePrompt} onChange={e => setStylePrompt(e.target.value)}
            rows={3} placeholder="e.g. Dark moody, silver type, Syne&#10;Or leave blank — AI decides"
            style={{ fontSize: 11, resize: 'none' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
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
  )
}
