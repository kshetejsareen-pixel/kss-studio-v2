import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore, claudeVision, claudeCall, M_OPUS, M_SONNET, M_HAIKU, exportPng, readFileAsDataUrl, resizeImage, extractBase64, PROXY } from '../store.jsx'

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

const POST_SYSTEM = (handle, context, analysis, copy, website, direction) => `You are a director of design with the combined sensibility of M/M Paris, Peter Saville, and the art directors behind Acne Studios, Celine, and Bottega Veneta's visual identity. You create Instagram posts that feel like they were published in a limited-edition monograph, not designed on Canva.

Studio: ${handle}
Brand context: ${context || 'Luxury commercial photography studio'}
Website: ${website || 'www.kshetejsareen.com'}
Image analysis — focal point: ${analysis?.focalPoint || 'centre'}, negative space: ${analysis?.negativeSpace || 'variable'}, suggested text zone: ${analysis?.suggestedTextZone || 'edge'}, mood: ${analysis?.mood || 'refined'}, palette: ${analysis?.colorPalette?.join(', ') || 'from image'}, composition: ${analysis?.composition || 'asymmetric'}, text contrast: ${analysis?.textContrast || 'light'}

${copy?.headline ? `Copy to set:\n- Headline: "${copy.headline}"${copy.sub ? `\n- Sub: "${copy.sub}"` : ''}${copy.cta ? `\n- CTA: "${copy.cta}"` : ''}${copy.website ? `\n- Website: "${copy.website}"` : ''}` : ''}
${direction ? `Directorial intent: ${direction}` : ''}

DESIGN INTELLIGENCE — apply this thinking to every decision:

Typography as a compositional force:
Typography doesn't fill space — it creates a relationship with the image. Consider: does the type whisper from a corner, letting the image breathe? Does it run along a strong vertical? Does it play with scale — tiny precise text against a vast image? The font must feel discovered, not chosen — a refined geometric sans for architectural tension, a humanist serif that honours the warmth of portraiture, a stark condensed for drama. Tracking and weight define temperature: wide-tracked light type reads as cold and precise; tighter, medium weight reads as intimate. Let the image's mood dictate.

Colour extracted, not applied:
Read the image's own palette. Text colour should create the minimum necessary contrast — don't over-contrast. A warm near-white on a warm scene reads more sophisticated than pure white. If you use any overlay, it should be so subtle (5–15% opacity) it's felt rather than seen — a slight darkening of a bright zone, not a box.

Layout as a single decisive gesture:
The strongest designs make one strong compositional decision, then everything else serves it. Don't scatter text across the image in multiple blocks. Find the one placement that creates the right tension with the image — text sitting in deep negative space, or text that frames the subject from outside the image zone, or a single line at the very bottom edge like a caption in a photography book.

What separates luxury from generic:
Luxury says one thing. Generic says many things loudly. The handle, the website, the CTA — they exist but they don't compete. The CTA is a whisper of invitation, not a button. The website is metadata, not marketing. The headline is a thought that completes the image, not a description of it. No category labels ("PORTRAIT", "EDITORIAL"). No decorative elements. No boxes around text. No justified text blocks. No stock-photo-template composition.

Technical requirements:
- Inline styles only — @import Google Fonts in a <style> tag
- Div exactly 1080×1350px, position:relative, overflow:hidden
- Use src="[IMAGE_SRC]" for img, url('[IMAGE_SRC]') for CSS background
- Image must be visible and dominant in the composition
- Return ONLY the HTML div, nothing else`

const STORY_SYSTEM = (handle, context, analysis, copy, website, direction) => `You are a director of design with the sensibility of M/M Paris, Peter Saville, and Bottega Veneta's creative direction. Create an Instagram Story for ${handle}.

Brand context: ${context || 'Luxury commercial photography'}
Website: ${website || 'www.kshetejsareen.com'}
Image mood: ${analysis?.mood || 'refined'} · palette: ${analysis?.colorPalette?.join(', ') || 'from image'} · text zone: ${analysis?.suggestedTextZone || 'edge'} · contrast: ${analysis?.textContrast || 'light'}

${copy?.headline ? `Copy: "${copy.headline}"${copy.sub ? ` / "${copy.sub}"` : ''}${copy.cta ? ` / CTA: "${copy.cta}"` : ''}` : ''}
${direction ? `Direction: ${direction}` : ''}

Apply the same design intelligence as for a post: type as a compositional element, colour from the image, one decisive layout gesture, no decorative elements, no category labels, no button-style CTAs. The 9:16 format creates a natural vertical canvas — use its height intentionally.

Technical: Inline styles. Div 1080×1920px. src="[IMAGE_SRC]". Image visible and dominant. Return ONLY HTML div.`

const COPY_SYSTEM = (handle, context, website, tone, imageAnalysis, visionDesc) => `You are writing Instagram copy for ${handle}, a luxury commercial photography studio.
This post showcases work shot for a brand. Copy appears on the photographer's Instagram feed.

${context ? `BRAND BRIEF (research findings):\n${context}` : `Studio: ${handle} — luxury commercial, editorial and advertising photography`}
Studio website: ${website || 'www.kshetejsareen.com'}
${tone ? `Tone override: ${tone}` : ''}
${imageAnalysis ? `Image mood: ${imageAnalysis.mood || 'refined'} · tones: ${imageAnalysis.dominantTones || 'varied'}` : ''}
${visionDesc ? `Image content: ${visionDesc}` : ''}

THE VOICE — derive from the brand:
Read the VOICE field in the brand brief. That is the emotional temperature and rhythm of every line.
If no VOICE field: read AESTHETIC and AUDIENCE and find the voice that lives in that world.
A furniture brand with architectural minimalism writes the way a building feels — sparse, decisive, material.
A fashion brand writes the way a glance works — incomplete, arresting, with space left open.
A hospitality brand writes the way a room welcomes — warm, precise, unhurried.
The copy should feel native. A reader who knows the brand should recognise the language.

THE THINKING — this is how the best copy works:
Copy doesn't describe what's in the image. It completes it.
The image says something — the copy finds the last word.
When the image shows the founders of a furniture brand: don't write about the people. Write about what drives someone to make objects that outlast them.
When the image shows a product in perfect light: don't describe the product. Write about what it means to see something clearly for the first time.
When the image shows an interior: don't list its features. Write about how a room holds memory.

The question to ask before writing: what does this photograph know that words almost can't say? Write towards that.

PERSPECTIVE:
You write as the photographer — the work is yours, the vision is yours. The subject serves the photograph.
CTA: an invitation to commission commercial or brand work from ${handle}. Never a family or portrait studio CTA.

What not to write:
- Headlines that describe subjects: "Three held still", "Man and woman by a wall"
- Subheadlines that explain the image: "Shot for Ravoh — a portrait of two people"
- Consumer CTAs: "Commission your portrait", "Preserve this moment"
- Clichés: "capturing moments", "timeless", "bespoke", "stunning", "through the lens", "artistry", "crafted"

Headlines: 2–5 words. The image carries the weight — the headline lands the last thought.
Website: ${website || 'www.kshetejsareen.com'}

Return JSON only:
{
  "headlines": ["strongest version", "second distinct option", "third distinct option"],
  "sub": "one line in the brand's voice, or null",
  "tagline": "optional, or null",
  "cta": "commission invitation — e.g. Book a shoot / Commission your story / Inquire now",
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
  const [copy, setCopy]                   = useState({ headline: '', sub: '', tagline: '', cta: '', website: '' })
  const [lockedFields, setLockedFields]   = useState({ headline: false, sub: false, tagline: false, cta: false })
  const [generatingCopy, setGeneratingCopy] = useState(false)
  const [copyTone, setCopyTone]             = useState('')
  const [headlineVariants, setHeadlineVariants] = useState([])
  const imgAnalysisCacheRef = useRef({})
  const website = copy.website || state.settings?.website || 'www.kshetejsareen.com'

  // Section collapse state
  const [openSections, setOpenSections] = useState({ copy: true, design: true, versions: false })
  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }))

  // Chat panel
  const [chatOpen, setChatOpen]           = useState(false)
  const [chatInput, setChatInput]         = useState('')
  const [chatHistory, setChatHistory]     = useState([])
  const [chatting, setChatting]           = useState(false)
  const chatEndRef = useRef(null)

  const canvasRef     = useRef(null)
  const filmRef       = useRef(null)
  // Stable refs for wheel handler (avoid stale closures without re-attaching the listener)
  const canvasSizeRef = useRef({ w: 600, h: 480 })
  const zoomRef       = useRef(zoom)
  const modeRef       = useRef(mode)
  useEffect(() => { canvasSizeRef.current = canvasSize }, [canvasSize])
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { modeRef.current = mode }, [mode])

  const visibleImages = state.images.filter(img => !(state.excludedNames || []).includes(img.name))
  const selectedImg = visibleImages.find(i => i.id === selectedImgId) || visibleImages[0] || null

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

  // Pinch-to-zoom + scroll: mounted once, reads live values via refs
  useEffect(() => {
    const el = canvasRef.current; if (!el) return
    const h = (e) => {
      // Two-finger swipe (no ctrlKey) → let the browser scroll the container natively
      if (!e.ctrlKey) return
      // Pinch-to-zoom (macOS trackpad sends ctrlKey=true for pinch)
      e.preventDefault()

      const rect   = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const dims = modeRef.current === 'story' ? { w: 1080, h: 1920 } : { w: 1080, h: 1350 }
      const cs   = canvasSizeRef.current
      const fit  = cs.w > 0 && cs.h > 0
        ? Math.min((cs.w - 48) / dims.w, (cs.h - 48) / dims.h) : 0.3
      const oldScale = zoomRef.current === 0 ? fit : zoomRef.current

      // Smooth exponential zoom speed (matches native trackpad feel)
      const newScale = Math.max(0.1, Math.min(3, oldScale * Math.pow(1.001, -e.deltaY)))

      // Keep the pixel under the cursor fixed in place after zoom
      const scaledW  = dims.w * oldScale
      const scaledH  = dims.h * oldScale
      // When content is smaller than container it's centered (margin:auto), so offset > 0
      const offsetX  = Math.max(0, (el.clientWidth  - scaledW) / 2)
      const offsetY  = Math.max(0, (el.clientHeight - scaledH) / 2)
      const contentX = (mouseX + el.scrollLeft - offsetX) / oldScale
      const contentY = (mouseY + el.scrollTop  - offsetY) / oldScale

      const newScaledW  = dims.w * newScale
      const newScaledH  = dims.h * newScale
      const newOffsetX  = Math.max(0, (el.clientWidth  - newScaledW) / 2)
      const newOffsetY  = Math.max(0, (el.clientHeight - newScaledH) / 2)

      setZoom(newScale)
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, contentX * newScale + newOffsetX - mouseX)
        el.scrollTop  = Math.max(0, contentY * newScale + newOffsetY - mouseY)
      })
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, []) // eslint-disable-line — intentionally mount-once; live values via refs above

  // Scroll filmstrip to selected
  useEffect(() => {
    if (!selectedImg || !filmRef.current) return
    const el = filmRef.current.querySelector(`[data-id="${selectedImg.id}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedImg?.id])

  // Auto scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatHistory])

  // Keyboard shortcuts (Space=fit, ←→=navigate, G=generate)
  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') { e.preventDefault(); setZoom(0) }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        setSelectedImgId(cur => {
          const imgs = state.images.filter(img => !(state.excludedNames || []).includes(img.name))
          const idx = imgs.findIndex(i => i.id === cur)
          const next = e.key === 'ArrowLeft' ? Math.max(0, idx - 1) : Math.min(imgs.length - 1, idx + 1)
          return imgs[next]?.id ?? cur
        })
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [state.images, state.excludedNames])

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
      // Step 1: vision analysis (cached per image)
      let imageAnalysis = imgAnalysisCacheRef.current[selectedImg.id] || null
      if (!imageAnalysis) {
        try {
          const av = await claudeVision(key, VISION_ANALYSIS_SYSTEM, 'Analyse this image for copy generation.', selectedImg.dataUrl, M_SONNET, 500)
          const am = av.match(/\{[\s\S]*\}/)
          if (am) { imageAnalysis = JSON.parse(am[0]); imgAnalysisCacheRef.current[selectedImg.id] = imageAnalysis }
        } catch { /* non-fatal */ }
      }

      // Step 2: generate copy — global brief + tone + image analysis
      const visionDesc = selectedImg.visionDesc || null
      const system = COPY_SYSTEM(state.settings.handle || '@kshetej.atwork', state.globalContext, website, copyTone, imageAnalysis, visionDesc)
      const lockedNote = Object.entries(lockedFields).filter(([,v])=>v).map(([k])=>k).join(', ')
      const prompt = [
        'Generate copy for this image.',
        lockedNote && `Locked fields (preserve exactly): ${lockedNote}.`,
        lockedFields.headline && copy.headline && `Keep headline as: "${copy.headline}"`,
        lockedFields.sub && copy.sub && `Keep subheadline as: "${copy.sub}"`,
        lockedFields.tagline && copy.tagline && `Keep tagline as: "${copy.tagline}"`,
        lockedFields.cta && copy.cta && `Keep CTA as: "${copy.cta}"`,
      ].filter(Boolean).join('\n')

      const raw = await claudeVision(key, system, prompt, selectedImg.dataUrl, M_OPUS, 700)
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        const headlines = Array.isArray(parsed.headlines) ? parsed.headlines.filter(Boolean) : (parsed.headline ? [parsed.headline] : [])
        setHeadlineVariants(headlines)
        setCopy(prev => ({
          headline: lockedFields.headline ? prev.headline : (headlines[0] || ''),
          sub:      lockedFields.sub      ? prev.sub      : (parsed.sub || ''),
          tagline:  lockedFields.tagline  ? prev.tagline  : (parsed.tagline || ''),
          cta:      lockedFields.cta      ? prev.cta      : (parsed.cta || ''),
          website:  prev.website || parsed.website || website,
        }))
        showToast('Copy generated ✓')
      }
    } catch(e) { showToast('Copy failed: ' + e.message) }
    finally { setGeneratingCopy(false) }
  }, [state, selectedImg, website, lockedFields, copy, copyTone, showToast])

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

      // Step 1.5 — Auto-generate copy from brief if no headline
      let activeCopy = copy
      if (!copy.headline && context) {
        setGenStep('Generating copy from brief…')
        try {
          const visionDesc = selectedImg.visionDesc || null
          const copySystem = COPY_SYSTEM(handle, context, website, null, analysis, visionDesc)
          const rawCopy = await claudeVision(key, copySystem, 'Generate copy for this image.', selectedImg.dataUrl, M_OPUS, 700)
          const cm = rawCopy.match(/\{[\s\S]*\}/)
          if (cm) {
            const parsed = JSON.parse(cm[0])
            const headlines = Array.isArray(parsed.headlines) ? parsed.headlines.filter(Boolean) : (parsed.headline ? [parsed.headline] : [])
            setHeadlineVariants(headlines)
            const freshCopy = {
              headline: headlines[0] || '',
              sub: parsed.sub || '',
              tagline: parsed.tagline || '',
              cta: parsed.cta || '',
              website: copy.website || parsed.website || website,
            }
            setCopy(freshCopy)
            activeCopy = freshCopy
          }
        } catch { /* non-fatal — proceed without copy */ }
      }

      // Step 2 — Generate design
      setGenStep('Generating design…')
      const hasCopy = activeCopy.headline || activeCopy.sub || activeCopy.tagline
      const system = isStory
        ? STORY_SYSTEM(handle, context, analysis, hasCopy ? activeCopy : null, website, stylePrompt)
        : POST_SYSTEM(handle, context, analysis, hasCopy ? activeCopy : null, website, stylePrompt)

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
          body: JSON.stringify({ model: M_OPUS, max_tokens: 4000, system, messages: [{ role: 'user', content: [
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
        raw = await claudeVision(key, system, prompt, selectedImg.dataUrl, M_OPUS, 4000)
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
  const hasCopyFilled = !!(copy.headline || copy.sub)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 296px', height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: VERTICAL FILMSTRIP ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)', background: '#060606' }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase' }}>
            {visibleImages.length} image{visibleImages.length !== 1 ? 's' : ''}
          </span>
          {state.excludedNames?.length > 0 && (
            <span style={{ fontSize: 8, color: 'rgba(180,60,60,.6)', fontFamily: 'var(--font-mono)' }}>· {state.excludedNames.length} off</span>
          )}
        </div>
        <div ref={filmRef} style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 0, scrollbarWidth: 'thin', scrollbarColor: '#1E1E1E transparent' }}>
          {visibleImages.length === 0 ? (
            <div style={{ fontSize: 9, color: '#2A2A2A', fontFamily: 'var(--font-mono)', padding: '12px 4px', lineHeight: 1.6 }}>
              {state.images.length ? 'All excluded in Plan' : 'Upload images to begin'}
            </div>
          ) : (() => {
            const groups = [
              { label: 'Portrait',  images: visibleImages.filter(i => (i.orientation || 'portrait') === 'portrait') },
              { label: 'Landscape', images: visibleImages.filter(i => i.orientation === 'landscape') },
              { label: 'Square',    images: visibleImages.filter(i => i.orientation === 'square') },
            ].filter(g => g.images.length > 0)
            return groups.map((group, gi) => (
              <div key={group.label} style={{ marginBottom: gi < groups.length - 1 ? 12 : 0 }}>
                <div style={{ fontSize: 7, color: '#2A2A2A', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', padding: '4px 2px 6px', userSelect: 'none' }}>
                  {group.label} {group.images.length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {group.images.map(img => {
                    const isSelected = selectedImg?.id === img.id
                    const aspect = img.width && img.height ? img.height / img.width : 1.25
                    return (
                      <div key={img.id} data-id={img.id}
                        onClick={() => setSelectedImgId(img.id)}
                        style={{ width: '100%', aspectRatio: `1 / ${aspect.toFixed(3)}`, position: 'relative', borderRadius: 3, overflow: 'hidden', cursor: 'pointer', outline: isSelected ? '2px solid var(--silver)' : '2px solid transparent', outlineOffset: 1, transition: 'outline-color .1s', flexShrink: 0 }}>
                        <img src={img.dataUrl} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                        {isSelected && <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 0 2px rgba(200,200,204,.3)' }} />}
                        <button
                          onClick={e => deleteImage(img.id, e)}
                          style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,.7)', border: '1px solid rgba(255,255,255,.15)', color: '#aaa', fontSize: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity .12s', backdropFilter: 'blur(4px)' }}
                          onMouseEnter={e => e.currentTarget.style.opacity = 1}
                          onMouseLeave={e => e.currentTarget.style.opacity = 0}>✕</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          })()}
        </div>
      </div>

      {/* ── CENTER: CANVAS ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>

        {/* Toolbar — zoom always visible */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 14px', alignItems: 'center', flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
          {['post', 'story'].map(m => (
            <button key={m} onClick={() => { setMode(m); setZoom(0) }}
              style={{ padding: '4px 12px', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', background: mode === m ? 'var(--silver-ghost)' : 'none', border: `1px solid ${mode === m ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: mode === m ? 'var(--silver)' : 'var(--text-3)', cursor: 'pointer' }}>
              {m === 'post' ? '4:5' : '9:16'}
            </button>
          ))}
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.max(0.1, +((z === 0 ? fitScale : z) * 0.9).toFixed(3)))}>−</button>
            <button onClick={() => setZoom(0)} style={{ minWidth: 44, padding: '3px 6px', fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r)', cursor: 'pointer', textAlign: 'center' }} title="Click to fit (Space)">
              {Math.round(displayScale * 100)}%
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => setZoom(z => Math.min(3, +((z === 0 ? fitScale : z) * 1.1).toFixed(3)))}>+</button>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {currentHtml && (
              <>
                <button className="btn btn-ghost btn-xs"
                  style={{ color: chatOpen ? 'var(--amber)' : 'var(--text-3)', borderColor: chatOpen ? 'rgba(255,170,0,.35)' : 'var(--border)' }}
                  onClick={() => setChatOpen(c => !c)}>
                  Refine
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => navigator.clipboard.writeText(currentHtml).then(() => showToast('Copied ✓'))}>
                  HTML
                </button>
              </>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div ref={canvasRef}
          style={{ flex: 1, background: '#0C0C0C', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0, position: 'relative' }}>
          {selectedImg || currentHtml ? (
            <div style={{
              width: Math.round(canvasDims.w * displayScale),
              height: Math.round(canvasDims.h * displayScale),
              flexShrink: 0,
              position: 'relative',
              margin: 'auto',
              boxShadow: currentHtml ? '0 0 0 1px rgba(255,255,255,0.06), 0 12px 60px rgba(0,0,0,.8)' : 'none',
            }}>
              {currentHtml ? (
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
              ) : (
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 2 }}>
                  <img
                    src={selectedImg.dataUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end', padding: '20px 16px' }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.4)', fontFamily: 'var(--font-mono)', letterSpacing: '.08em' }}>
                      Ready · press G or click Generate →
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--text-3)' }}>
              <div style={{ fontSize: 32, opacity: .05 }}>◫</div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>Select an image from the left panel</div>
            </div>
          )}
          {generating && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(8px)' }}>
              <div style={{ textAlign: 'center' }}>
                <span className="spin" style={{ width: 18, height: 18, borderWidth: 2, display: 'block', margin: '0 auto 10px' }} />
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', fontFamily: 'var(--font-mono)', letterSpacing: '.08em' }}>{genStep}</div>
              </div>
            </div>
          )}
        </div>

        {/* Refine chat drawer */}
        {chatOpen && currentHtml && (
          <div style={{ flexShrink: 0, background: '#080808', borderTop: '1px solid var(--border)', height: 200, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--amber)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', flex: 1 }}>Refine — describe a change</span>
              <button onClick={() => { setChatOpen(false); setChatHistory([]) }} style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {chatHistory.length === 0 && (
                <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>
                  "larger headline" · "shift type to bottom" · "darken overlay" · "use italic serif" · "thin white rule"
                </div>
              )}
              {chatHistory.map((m, i) => (
                <div key={i} style={{ fontSize: 11, color: m.role === 'user' ? 'var(--silver)' : 'var(--text-2)', fontFamily: m.role === 'user' ? 'var(--font-mono)' : 'var(--font-body)', padding: m.role === 'user' ? '4px 8px' : '0', background: m.role === 'user' ? 'var(--surface)' : 'none', borderRadius: 3, alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {m.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6 }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder="Describe a change… (Enter)"
                disabled={chatting}
                style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text)', fontSize: 11, padding: '6px 10px', fontFamily: 'var(--font-body)', outline: 'none' }}
              />
              <button className="btn btn-ghost btn-sm" onClick={sendChat} disabled={chatting || !chatInput.trim()}>
                {chatting ? <span className="spin" /> : '→'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT: CONTROLS ── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-raised)' }}>

        {/* Selected image + brief — always visible header */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {selectedImg ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 3, overflow: 'hidden', border: '1px solid var(--silver-edge)', flexShrink: 0 }}>
                <img src={selectedImg.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedImg.name}</div>
                <div style={{ fontSize: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {selectedImg.width && selectedImg.height ? `${selectedImg.width}×${selectedImg.height}` : ''}
                  {selectedImg.orientation ? ` · ${selectedImg.orientation}` : ''}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>No image selected</div>
          )}
          {/* Brief — read-only reference, edit at top bar */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '6px 9px' }}>
            <div style={{ fontSize: 7, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>Brief</div>
            <div style={{ fontSize: 9, color: state.globalContext ? 'var(--text-2)' : 'var(--text-3)', fontFamily: 'var(--font-mono)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {state.globalContext || '— add in the bar above —'}
            </div>
          </div>
        </div>

        {/* Scrollable sections */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* ── COPY SECTION ── */}
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => toggleSection('copy')}
              style={{ width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 7, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                Copy
                {hasCopyFilled && <span style={{ color: 'rgba(80,180,80,.7)', fontSize: 7 }}>✓</span>}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-3)', lineHeight: 1 }}>{openSections.copy ? '▲' : '▼'}</span>
            </button>
            {openSections.copy && (
              <div style={{ padding: '0 14px 12px' }}>
                {/* Tone presets */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 10 }}>
                  {['Editorial', 'Interrogative', 'Declarative', 'Poetic', 'Provocative'].map(t => (
                    <button key={t} onClick={() => setCopyTone(copyTone === t ? '' : t)}
                      style={{ padding: '3px 7px', fontSize: 8, fontFamily: 'var(--font-mono)', background: copyTone === t ? 'var(--silver-ghost)' : 'none', border: `1px solid ${copyTone === t ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: copyTone === t ? 'var(--silver)' : 'var(--text-3)', cursor: 'pointer' }}>
                      {t}
                    </button>
                  ))}
                </div>

                <button className="btn btn-ghost btn-sm btn-full" onClick={generateCopy} disabled={generatingCopy || !selectedImg} style={{ marginBottom: 10 }}>
                  {generatingCopy ? <><span className="spin" /> Generating…</> : '✦ Generate Copy'}
                </button>

                {headlineVariants.length > 1 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 7, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 5 }}>Options — pick one</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {headlineVariants.map((h, i) => (
                        <button key={i} onClick={() => setCopy(c => ({ ...c, headline: h }))}
                          style={{ padding: '6px 9px', textAlign: 'left', fontSize: 10, background: copy.headline === h ? 'var(--silver-ghost)' : 'none', border: `1px solid ${copy.headline === h ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: copy.headline === h ? 'var(--silver)' : 'var(--text-2)', cursor: 'pointer', fontFamily: 'var(--font-body)', lineHeight: 1.3 }}>
                          {h}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {[
                  ['Headline',    'headline', '2–5 decisive words'],
                  ['Sub',         'sub',      'One line of context'],
                  ['Tagline',     'tagline',  'Studio voice — optional'],
                  ['CTA',         'cta',      'Invitation, not a command'],
                ].map(([label, key, ph]) => (
                  <div key={key} style={{ marginBottom: 6, display: 'flex', gap: 5, alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 7, color: lockedFields[key] ? 'var(--silver)' : 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>
                        {label}{lockedFields[key] && <span style={{ opacity: .6, marginLeft: 3 }}>·lock</span>}
                      </div>
                      <input className="input" value={copy[key] || ''} onChange={e => setCopy(c => ({ ...c, [key]: e.target.value }))}
                        placeholder={ph} disabled={lockedFields[key]}
                        style={{ fontSize: 11, padding: '5px 8px', opacity: lockedFields[key] ? .5 : 1 }} />
                    </div>
                    <button onClick={() => setLockedFields(l => ({ ...l, [key]: !l[key] }))}
                      title={lockedFields[key] ? 'Unlock' : 'Lock'}
                      style={{ width: 20, height: 20, marginTop: 14, flexShrink: 0, background: lockedFields[key] ? 'var(--silver-ghost)' : 'none', border: `1px solid ${lockedFields[key] ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: lockedFields[key] ? 'var(--silver)' : 'var(--text-3)', cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {lockedFields[key] ? '●' : '○'}
                    </button>
                  </div>
                ))}

                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 7, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 3 }}>Website</div>
                  <input className="input" value={copy.website || ''} onChange={e => setCopy(c => ({ ...c, website: e.target.value }))}
                    placeholder="www.kshetejsareen.com" style={{ fontSize: 11, padding: '5px 8px' }} />
                </div>

                {hasCopyFilled && (
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => { setCopy({ headline: '', sub: '', tagline: '', cta: '', website: '' }); setLockedFields({ headline: false, sub: false, tagline: false, cta: false }); setHeadlineVariants([]) }}>Clear</button>
                    <button className="btn btn-ghost btn-xs" onClick={() => setLockedFields({ headline: false, sub: false, tagline: false, cta: false })}>Unlock all</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── DESIGN SECTION ── */}
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => toggleSection('design')}
              style={{ width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 7, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                Design Direction
                {stylePrompt && <span style={{ color: 'rgba(80,180,80,.7)', fontSize: 7 }}>✓</span>}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-3)', lineHeight: 1 }}>{openSections.design ? '▲' : '▼'}</span>
            </button>
            {openSections.design && (
              <div style={{ padding: '0 14px 12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 10 }}>
                  {[
                    ['Subject dominant',    'Subject fills the frame. Type bows to it.'],
                    ['Negative space',      'Build around open space. Subject and text breathe.'],
                    ['Graphic tension',     'Visual tension between image and type.'],
                    ['Editorial stillness', 'Magazine spread that stopped time.'],
                    ['Layered depth',       'Type in its own plane, not on top.'],
                    ['Cinematic',           'Feels like a still from a film.'],
                  ].map(([label, p]) => (
                    <button key={label} onClick={() => setStylePrompt(stylePrompt === p ? '' : p)}
                      style={{ padding: '6px 8px', textAlign: 'left', fontSize: 8, background: stylePrompt === p ? 'var(--silver-ghost)' : 'none', border: `1px solid ${stylePrompt === p ? 'var(--silver-edge)' : 'var(--border)'}`, borderRadius: 'var(--r)', color: stylePrompt === p ? 'var(--silver)' : 'var(--text-2)', cursor: 'pointer', lineHeight: 1.3 }}>
                      <div style={{ fontWeight: 600, marginBottom: 1 }}>{label}</div>
                      <div style={{ fontSize: 7, opacity: .5 }}>{p}</div>
                    </button>
                  ))}
                </div>

                <textarea className="textarea" value={stylePrompt} onChange={e => setStylePrompt(e.target.value)}
                  rows={2} placeholder="Custom direction — composition and feeling only"
                  style={{ fontSize: 11, resize: 'none', marginBottom: 10 }} />

                <div style={{ fontSize: 7, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 6 }}>Reference Design</div>
                {refImgDataUrl ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <img src={refImgDataUrl} alt="ref" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 'var(--r)', border: '1px solid var(--silver-edge)', display: 'block' }} />
                      <button onClick={() => setRefImgDataUrl(null)} style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: '#1A1A1A', border: '1px solid var(--border-2)', color: 'var(--text-3)', cursor: 'pointer', fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                    </div>
                    <div style={{ fontSize: 8, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>Claude will match this style</div>
                  </div>
                ) : (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: '1px dashed var(--border-2)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                    <input type="file" accept="image/*" onChange={handleRefImg} style={{ display: 'none' }} />
                    ↑ Upload a design to match
                  </label>
                )}
              </div>
            )}
          </div>

          {/* ── VERSION HISTORY ── */}
          {iterations.length > 1 && mode === 'post' && (
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <button
                onClick={() => toggleSection('versions')}
                style={{ width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: 7, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', letterSpacing: '.12em', textTransform: 'uppercase', flex: 1 }}>
                  Versions ({iterations.length})
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-3)', lineHeight: 1 }}>{openSections.versions ? '▲' : '▼'}</span>
              </button>
              {openSections.versions && (
                <div style={{ padding: '0 14px 12px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {iterations.map((iter, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <div style={{ aspectRatio: '4/5', borderRadius: 3, overflow: 'hidden', cursor: 'pointer', border: `1px solid ${iter.starred ? 'var(--amber)' : 'var(--border)'}`, transition: 'border-color .12s' }}
                        onClick={() => { setDesignHtml(iter.html); setZoom(0) }} title={iter.prompt}>
                        <div style={{ transform: `scale(${(((296-28)/3) - 4)/1080})`, transformOrigin: 'top left', width: 1080, height: 1350, pointerEvents: 'none' }}
                          dangerouslySetInnerHTML={{ __html: iter.html }} />
                      </div>
                      <button onClick={() => setIterations(prev => prev.map((it, j) => j === i ? { ...it, starred: !it.starred } : it))}
                        style={{ position: 'absolute', top: 3, left: 3, background: 'rgba(0,0,0,.6)', border: 'none', fontSize: 9, cursor: 'pointer', opacity: iter.starred ? 1 : .35, color: iter.starred ? 'var(--amber)' : '#fff', borderRadius: 2, padding: '1px 3px', backdropFilter: 'blur(4px)' }}>★</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Keyboard hint */}
        <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontSize: 7, color: '#2A2A2A', fontFamily: 'var(--font-mono)', letterSpacing: '.08em' }}>Space fit · ←→ navigate</span>
        </div>

        {/* Generate + Export — sticky bottom */}
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
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
