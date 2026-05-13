import { useState, useCallback, useRef, useEffect } from 'react'
import { useStore, claudeCall, claudeCallWithImages, claudeAnalyzeLayout, claudeVision, M_SONNET, M_HAIKU } from '../store.jsx'
import CarouselModal from './CarouselModal.jsx'
import ShootChecklist from './ShootChecklist.jsx'

const SIZE_OPTIONS = [
  { label: '1:1',  ratio: '1:1',  w: 1080, h: 1080 },
  { label: '4:5 ★', ratio: '4:5', w: 1080, h: 1350 },
  { label: '9:16', ratio: '9:16', w: 1080, h: 1920 },
  { label: '16:9', ratio: '16:9', w: 1080, h: 608  },
]

const POST_FORMATS = [
  { label: 'Global', ratio: null },
  { label: '4:5',    ratio: '4:5',  w: 1080, h: 1350 },
  { label: '1:1',    ratio: '1:1',  w: 1080, h: 1080 },
  { label: '16:9',   ratio: '16:9', w: 1080, h: 608  },
  { label: '9:16',   ratio: '9:16', w: 1080, h: 1920 },
]

function makeEmptyPost() {
  return { imageIndex: null, slides: [], type: 'single', caption: '', theme: '', notes: '', locked: false, panX: 50, panY: 50, formatOverride: null, rotate: 0, flipH: false, flipV: false, captionApproved: false }
}

function getCellRatio(post, globalSize) {
  if (post.formatOverride) {
    const f = POST_FORMATS.find(f => f.ratio === post.formatOverride)
    if (f && f.w) return `${f.w}/${f.h}`
  }
  return `${globalSize.w}/${globalSize.h}`
}

function getImgTransform(post) {
  const parts = []
  if (post.rotate) parts.push(`rotate(${post.rotate}deg)`)
  if (post.flipH)  parts.push('scaleX(-1)')
  if (post.flipV)  parts.push('scaleY(-1)')
  return parts.length ? parts.join(' ') : 'none'
}

export default function PlanTab({ showToast, onTabChange }) {
  const { state, set, resetPlan, setPlanItem, updateImage } = useStore()
  const [postCount, setPostCount]   = useState(9)
  const [size, setSize]             = useState(SIZE_OPTIONS[1])
  const [mix, setMix]               = useState('mixed')
  const [planning, setPlanning]     = useState(false)
  const [inspectIdx, setInspectIdx] = useState(null)
  const [dragOver, setDragOver]     = useState(null)
  const [imageTab, setImageTab]     = useState('all')
  const [gridScale, setGridScale]   = useState(1)
  const [thumbScale, setThumbScale] = useState(1)
  const [panModeIdx, setPanModeIdx] = useState(null)  // { postIdx, slideIdx } or null
  const [carouselPreview, setCarouselPreview] = useState(null) // planIdx or null
  const [showChecklist, setShowChecklist] = useState(false)
  const [excludedImgIds, setExcludedImgIds] = useState(new Set())
  const [hoveredThumb, setHoveredThumb]   = useState(null)
  const [analysisProgress, setAnalysisProgress] = useState(null) // null | { done, total }
  const [directorOpen, setDirectorOpen]   = useState(false)
  const [referenceLinks, setReferenceLinks] = useState([])
  const [refLinkInput, setRefLinkInput]   = useState('')
  const [planningNotes, setPlanningNotes] = useState('')
  const [chatHistory, setChatHistory]     = useState([])
  const [refineInput, setRefineInput]     = useState('')
  const [refining, setRefining]           = useState(false)
  const notesTimer = useRef(null)
  const panDrag = useRef(null)
  const gridScrollRef = useRef(null)

  useEffect(() => {
    try {
      const links = localStorage.getItem('kss_ref_links')
      if (links) {
        const parsed = JSON.parse(links)
        // Migrate legacy string[] to object[]
        const normalised = parsed.map(l =>
          typeof l === 'string'
            ? { url: l, domain: (() => { try { return new URL(l).hostname.replace('www.', '') } catch { return l } })(), analysis: null, analyzing: false }
            : { ...l, analyzing: false }
        )
        setReferenceLinks(normalised)
      }
      const notes = localStorage.getItem('kss_plan_notes')
      if (notes) setPlanningNotes(notes)
    } catch {}
  }, [])

  useEffect(() => {
    const el = gridScrollRef.current
    if (!el) return
    const handler = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setGridScale(s => Math.min(2.0, Math.max(0.3, +(s + (e.deltaY < 0 ? 0.05 : -0.05)).toFixed(2))))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  const imgByIdx = useCallback(idx => {
    if (!idx || idx < 1 || idx > state.images.length) return null
    return state.images[idx - 1] || null
  }, [state.images])

  const toggleExclude = useCallback(imgId => {
    setExcludedImgIds(prev => { const next = new Set(prev); if (next.has(imgId)) next.delete(imgId); else next.add(imgId); return next })
  }, [])

  // Detect white-bg from either structured visionBg tag or free-text description
  const isWhiteBg = useCallback(img => {
    if (img.visionBg) return img.visionBg === 'white-studio'
    if (!img.visionDesc) return false
    const d = img.visionDesc.toLowerCase()
    return d.includes('white') && (d.includes('background') || d.includes('studio') || d.includes('backdrop') || d.includes('surface'))
  }, [])

  const analyzeImages = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add Anthropic API key in Settings'); return }
    const targets = state.images.filter(img => !img.visionDesc)
    if (!targets.length) { showToast('All images already analysed ✓'); return }
    setAnalysisProgress({ done: 0, total: targets.length })
    const system = 'You are a photography analyst for Instagram content planning. Be precise about background and subject type — these are used to filter images by category.'
    const userText = `Analyse this photo. Respond in EXACTLY this format (no other text):
Subject: [person-portrait / group-portrait / product-object / lifestyle-scene / architecture / abstract]
Background: [white-studio / light-neutral / dark-studio / natural-outdoor / textured-wall / colored]
Mood: [editorial-luxury / clean-commercial / candid-lifestyle / architectural]
Summary: [one concise sentence describing the image]`
    let done = 0
    for (let i = 0; i < targets.length; i += 4) {
      const batch = targets.slice(i, i + 4)
      await Promise.all(batch.map(async img => {
        try {
          updateImage(img.id, { visionAnalyzing: true })
          const raw = await claudeVision(key, system, userText, img.dataUrl, M_HAIKU, 150)
          const bgMatch = raw.match(/Background:\s*([a-z-]+)/i)
          const subjMatch = raw.match(/Subject:\s*([a-z-]+)/i)
          const summaryMatch = raw.match(/Summary:\s*(.+)/i)
          const visionBg = bgMatch ? bgMatch[1].toLowerCase() : 'unknown'
          const visionSubject = subjMatch ? subjMatch[1].toLowerCase() : 'unknown'
          const visionDesc = summaryMatch ? summaryMatch[1].trim().replace(/^["']|["']$/g, '') : raw.trim().replace(/^["']|["']$/g, '')
          updateImage(img.id, { visionDesc, visionBg, visionSubject, visionAnalyzing: false })
        } catch {
          updateImage(img.id, { visionAnalyzing: false })
        }
        done++
        setAnalysisProgress({ done, total: targets.length })
      }))
    }
    setAnalysisProgress(null)
    const whiteBgCount = state.images.filter(isWhiteBg).length
    showToast(`Analysis complete ✓ — ${whiteBgCount} white-background images detected`)
  }, [state.images, state.settings.anthropicKey, updateImage, showToast, isWhiteBg])

  const handleSetLayout = () => {
    const current = state.plan.length
    if (current === postCount) { showToast(`Already ${postCount} slots`); return }
    if (current < postCount) {
      resetPlan([...state.plan, ...Array.from({ length: postCount - current }, makeEmptyPost)])
    } else {
      const losing = state.plan.slice(postCount).filter(p => p.imageIndex).length
      if (losing > 0 && !confirm(`Reducing to ${postCount} slots will remove ${losing} filled posts. Continue?`)) return
      resetPlan(state.plan.slice(0, postCount))
    }
    showToast(`Layout set to ${postCount} posts`)
  }

  const handlePlanWithClaude = async () => {
    if (!state.images.length) { showToast('Import images first'); return }
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add Anthropic API key in Settings'); return }
    setPlanning(true)
    const totalImgs = state.images.length
    const handle = state.settings.handle || '@kshetejsareenstudios'
    const globalCtx = state.globalContext
    const ratio = `${size.w}×${size.h}`
    // Client-side enforce "no white background" if director notes say so.
    // This is done here rather than relying on Claude to interpret descriptions —
    // LLMs can't reliably match natural-language color constraints to free-text descriptions.
    const notesLower = planningNotes.toLowerCase()
    const autoExcludeWhiteBg = /no white|don.?t use white|avoid white|without white|exclude white/i.test(planningNotes)

    // Keep original 1-based indices intact so imgByIdx resolves correctly after planning.
    let autoExcludedCount = 0
    const imgDesc = state.images.slice(0, 40)
      .map((img, i) => {
        if (excludedImgIds.has(img.id)) return null
        if (autoExcludeWhiteBg && isWhiteBg(img)) { autoExcludedCount++; return null }
        const base = `${i + 1}. ${img.name} [${img.orientation}]`
        const tag = img.visionBg && img.visionBg !== 'unknown' ? ` [bg:${img.visionBg}]` : ''
        return img.visionDesc ? `${base}${tag} — ${img.visionDesc}` : base
      })
      .filter(Boolean).join('\n')
    const analysedCount = state.images.filter(img => img.visionDesc && !excludedImgIds.has(img.id)).length
    const availableCount = state.images.filter(img => !excludedImgIds.has(img.id) && !(autoExcludeWhiteBg && isWhiteBg(img))).length
    const perPost = availableCount / postCount
    const distributionNote = perPost >= 2
      ? `${availableCount} available images across ${postCount} posts — use CAROUSELS (~${Math.ceil(perPost)} slides each).`
      : `${availableCount} images, ${postCount} posts — 1 image per post.`
    const landscapes = state.images.filter(i => i.orientation === 'landscape').length
    const orientNote = landscapes > 0 ? `IMPORTANT: Never mix landscape and portrait in the same carousel.` : ''
    const mixLabel = mix === 'carousels' ? 'carousels heavy — most posts should be carousels with multiple slides'
      : mix === 'stills' ? 'stills only — every post is a single image, no carousels'
      : 'mixed — vary between singles and carousels'
    const analysedRefs = referenceLinks.filter(l => l.analysis)
    const refsSection = analysedRefs.length
      ? `REFERENCE GRID ANALYSIS — apply this rhythm and content mix to your plan:\n${analysedRefs.map(l => `• ${l.domain}: ${l.analysis}`).join('\n\n')}`
      : referenceLinks.length
        ? `Reference context:\n${referenceLinks.map(l => l.url || l).join('\n')}`
        : ''
    // Collect uploaded reference screenshots — passed as actual images to the API
    const refScreenshots = referenceLinks.filter(l => l.thumb).map(l => l.thumb)
    const refVisualNote = refScreenshots.length
      ? `REFERENCE GRID IMAGES ATTACHED: ${refScreenshots.length} reference screenshot(s) are embedded above as images. Study them carefully — your image assignments must produce a grid that mirrors their exact: layout rhythm, alternating pattern (e.g. portrait → product → portrait), content type sequencing, and visual balance.`
      : ''
    const system = [
      `You are a luxury Instagram content strategist for Kshetej Sareen Studios (${handle}).`,
      planningNotes.trim() ? `DIRECTOR'S MANDATE — follow these instructions precisely, they override everything else:\n${planningNotes.trim()}` : '',
      `HARD RULES — never break these:
- You MUST return exactly ${postCount} objects in the JSON array — no fewer, no more.
- Only use image indices from the provided list. Never invent an index that isn't listed.
- Every image index must appear AT MOST ONCE across all posts and all carousel slides. No repeats whatsoever.
- Respond with ONLY a valid JSON array. Zero text before or after. No explanation, no commentary.`,
    ].filter(Boolean).join('\n\n')
    const prompt = [
      `Plan an Instagram grid of ${postCount} posts for ${handle}.`,
      refVisualNote,
      refsSection,
      `Brand context: ${globalCtx || 'None'}`,
      `Post format: ${ratio} · Content mix: ${mixLabel}`,
      distributionNote,
      orientNote,
      `Available images — ONLY use indices from this list (1-based, each index once only)${analysedCount > 0 ? ` — ${analysedCount} have visual descriptions after the dash` : ''}:\n${imgDesc}`,
      `Return ONLY a JSON array of exactly ${postCount} objects:\n[{"imageIndex":1,"slides":[1,3],"type":"single|carousel|reel","theme":"short label","notes":""}]`,
    ].filter(Boolean).join('\n\n')
    try {
      const raw = refScreenshots.length
        ? await claudeCallWithImages(key, system, prompt, refScreenshots, M_SONNET, 4000)
        : await claudeCall(key, system, prompt, M_SONNET, 4000)
      const match = raw.match(/\[[\s\S]*?\](?=\s*$|\s*[^,\w])/s) || raw.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('No JSON array in response')
      const parsed = JSON.parse(match[0])
      console.log('[KSS Plan] Claude raw:', JSON.stringify(parsed).slice(0, 600))

      // Detect 0-based indices — check BOTH imageIndex and slides values
      const allNums = parsed.flatMap(p => {
        const ns = []
        if (typeof p.imageIndex === 'number') ns.push(p.imageIndex)
        if (Array.isArray(p.slides)) p.slides.forEach(s => { if (typeof s === 'number') ns.push(s) })
        return ns
      })
      const minNum = allNums.length ? Math.min(...allNums) : Infinity
      const shift = minNum === 0 ? 1 : 0

      const planItems = parsed.map(p => {
        const rawIdx = p.imageIndex ?? p.image_index ?? p.index ?? null
        const idx = typeof rawIdx === 'number' ? rawIdx + shift : null
        const rawSlides = Array.isArray(p.slides) ? p.slides : []
        const slides = rawSlides
          .map(s => typeof s === 'number' ? s + shift : null)
          .filter(s => s !== null && s >= 1 && s <= totalImgs)
        // Use slides[0] as imageIndex if Claude left imageIndex null/invalid
        const baseIdx = (idx !== null && idx >= 1 && idx <= totalImgs) ? idx : (slides[0] ?? null)
        const imageIndex = baseIdx
        return { ...makeEmptyPost(), imageIndex, slides: slides.length ? slides : imageIndex ? [imageIndex] : [], type: p.type || 'single', theme: p.theme || '', notes: p.notes || '' }
      })

      // Enforce exact postCount — pad with empty slots if Claude returned fewer
      while (planItems.length < postCount) planItems.push(makeEmptyPost())
      const finalPlan = planItems.slice(0, postCount)
      const filled = finalPlan.filter(p => p.imageIndex).length
      resetPlan(finalPlan)
      set('postW', size.w); set('postH', size.h)
      setChatHistory([{ role: 'claude', content: `Plan generated — ${filled} / ${finalPlan.length} posts filled. Ask me to refine anything.` }])
      if (filled === 0) {
        console.warn('[KSS Plan] All imageIndexes resolved to null. Raw data:', parsed)
        showToast('Plan set but images not matched — check console')
      } else {
        const autoNote = autoExcludedCount > 0 ? ` (${autoExcludedCount} white-bg auto-excluded)` : ''
        showToast(`Layout ready — ${filled} of ${finalPlan.length} posts${autoNote}`)
      }
    } catch (e) { showToast('Error: ' + e.message); console.error(e) }
    finally { setPlanning(false) }
  }

  const addReferenceLink = async (rawUrl) => {
    const url = rawUrl.trim()
    if (!url) return
    let domain = url
    try { domain = new URL(url).hostname.replace('www.', '') } catch {}
    const entry = { url, domain, analysis: null, analyzing: true, error: null, thumb: null }
    const updated = [...referenceLinks, entry]
    setReferenceLinks(updated)
    setRefLinkInput('')
    const key = state.settings.anthropicKey
    if (!key) {
      const done = updated.map((l, i) => i === updated.length - 1 ? { ...l, analyzing: false, error: 'Add API key in Settings' } : l)
      setReferenceLinks(done); localStorage.setItem('kss_ref_links', JSON.stringify(done)); return
    }
    try {
      const analysis = await claudeAnalyzeLayout(key, url)
      setReferenceLinks(prev => { const next = prev.map(l => l.url === url && l.analyzing ? { ...l, analysis, analyzing: false } : l); localStorage.setItem('kss_ref_links', JSON.stringify(next)); return next })
    } catch (e) {
      const errMsg = e.message?.toLowerCase().includes('pinterest') || e.message?.toLowerCase().includes('login') || e.message?.toLowerCase().includes('redirect')
        ? 'Pinterest requires login — upload a screenshot instead'
        : 'Could not analyse — upload a screenshot instead'
      setReferenceLinks(prev => { const next = prev.map(l => l.url === url && l.analyzing ? { ...l, analyzing: false, error: errMsg } : l); localStorage.setItem('kss_ref_links', JSON.stringify(next)); return next })
    }
  }

  const addReferenceScreenshot = async (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const key = state.settings.anthropicKey
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target.result
      const thumb = dataUrl
      const entry = { url: null, domain: file.name.replace(/\.[^.]+$/, ''), analysis: null, analyzing: true, error: null, thumb }
      setReferenceLinks(prev => [...prev, entry])
      if (!key) {
        setReferenceLinks(prev => { const next = [...prev]; next[next.length - 1] = { ...next[next.length - 1], analyzing: false, error: 'Add API key in Settings' }; localStorage.setItem('kss_ref_links', JSON.stringify(next)); return next })
        return
      }
      try {
        const system = 'You are a visual content strategist analysing moodboard screenshots for Instagram grid planning. Be concise and specific.'
        const userText = 'Analyse this screenshot and describe the visual layout: grid pattern, content types (product detail, portrait, lifestyle, etc.), dominant image ratio, and any notable sequencing or colour story. Be actionable for an Instagram content planner.'
        const analysis = await claudeVision(key, system, userText, dataUrl)
        setReferenceLinks(prev => { const next = prev.map(l => l.thumb === thumb && l.analyzing ? { ...l, analysis: analysis.substring(0, 600), analyzing: false } : l); localStorage.setItem('kss_ref_links', JSON.stringify(next)); return next })
      } catch (err) {
        setReferenceLinks(prev => { const next = prev.map(l => l.thumb === thumb && l.analyzing ? { ...l, analyzing: false, error: err.message } : l); localStorage.setItem('kss_ref_links', JSON.stringify(next)); return next })
      }
    }
    reader.readAsDataURL(file)
  }

  const handleRefine = async () => {
    const instruction = refineInput.trim()
    if (!instruction) return
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add Anthropic API key in Settings'); return }
    setRefining(true)
    const imgDesc = state.images.slice(0, 30).map((img, i) => `${i + 1}. ${img.name} [${img.orientation}]`).join('\n')
    const currentPlan = JSON.stringify(state.plan.map(p => ({ imageIndex: p.imageIndex, type: p.type, theme: p.theme, slides: p.slides })))
    const system = `You are a luxury Instagram content strategist. Refine the plan per the director's instruction. Return ONLY a valid JSON array in the same format as the input plan.`
    const prompt = `Current plan (${state.plan.length} posts): ${currentPlan}\nAvailable images:\n${imgDesc}\nDirector instruction: ${instruction}`
    const userMsg = { role: 'user', content: instruction }
    try {
      const raw = await claudeCall(key, system, prompt, M_HAIKU, 4000)
      const match = raw.match(/\[[\s\S]*?\](?=\s*$|\s*[^,\w])/s) || raw.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('No JSON array in response')
      const parsed = JSON.parse(match[0])
      const totalImgs = state.images.length
      const minIdx = Math.min(...parsed.map(p => typeof p.imageIndex === 'number' ? p.imageIndex : Infinity))
      const shift = minIdx === 0 ? 1 : 0
      const planItems = parsed.map((p, i) => {
        const rawIdx = p.imageIndex ?? p.image_index ?? p.index ?? null
        const idx = typeof rawIdx === 'number' ? rawIdx + shift : null
        const imageIndex = (idx !== null && idx >= 1 && idx <= totalImgs) ? idx : null
        const rawSlides = Array.isArray(p.slides) ? p.slides : []
        const slides = rawSlides.map(s => typeof s === 'number' ? s + shift : null).filter(s => s !== null && s >= 1 && s <= totalImgs)
        const base = state.plan[i] ? { ...state.plan[i] } : makeEmptyPost()
        return { ...base, imageIndex, slides: slides.length ? slides : imageIndex ? [imageIndex] : [], type: p.type || base.type || 'single', theme: p.theme || base.theme || '', notes: p.notes || base.notes || '' }
      })
      resetPlan(planItems)
      setChatHistory(h => [...h, userMsg, { role: 'claude', content: `Done — ${planItems.filter(p => p.imageIndex).length} / ${planItems.length} posts updated.` }])
      setRefineInput('')
      showToast('Plan refined ✓')
    } catch (e) {
      setChatHistory(h => [...h, userMsg, { role: 'claude', content: `Error: ${e.message}` }])
      showToast('Refine failed: ' + e.message)
    } finally { setRefining(false) }
  }

  const handleCellDrop = useCallback((e, cellIdx) => {
    e.preventDefault(); setDragOver(null)
    const p = state.plan[cellIdx]
    const isEmpty = !p?.imageIndex
    const sidebarId = e.dataTransfer.getData('sidebar-img-id')
    if (sidebarId) {
      const imgIdx = state.images.findIndex(im => im.id === sidebarId) + 1
      if (imgIdx > 0) {
        if (isEmpty) { const np = [...state.plan]; np[cellIdx] = { ...np[cellIdx], imageIndex: imgIdx, slides: [imgIdx], type: 'single' }; resetPlan(np); setInspectIdx(cellIdx) }
        else if (e.shiftKey || p.type === 'carousel') appendSlide(cellIdx, imgIdx)
        else { const np = [...state.plan]; np[cellIdx] = { ...np[cellIdx], imageIndex: imgIdx, slides: [imgIdx] }; resetPlan(np) }
      }
      return
    }
    const uIdx = e.dataTransfer.getData('unassigned-img')
    if (uIdx) { const imgIdx = parseInt(uIdx); if (!isNaN(imgIdx)) { if (isEmpty) { const np = [...state.plan]; np[cellIdx] = { ...np[cellIdx], imageIndex: imgIdx, slides: [imgIdx], type: 'single' }; resetPlan(np); setInspectIdx(cellIdx) } else appendSlide(cellIdx, imgIdx) }; return }
    const from = parseInt(e.dataTransfer.getData('plan-cell-idx'))
    if (!isNaN(from) && from !== cellIdx && !state.plan[from]?.locked && !state.plan[cellIdx]?.locked) {
      const np = [...state.plan]; [np[from], np[cellIdx]] = [np[cellIdx], np[from]]
      if (inspectIdx === from) setInspectIdx(cellIdx); else if (inspectIdx === cellIdx) setInspectIdx(from)
      resetPlan(np); showToast('Swapped')
    }
  }, [state.plan, state.images, inspectIdx, resetPlan, showToast])

  const appendSlide = useCallback((planIdx, imgIdx) => {
    const p = state.plan[planIdx]
    const slides = p.slides?.length ? [...p.slides] : [p.imageIndex].filter(Boolean)
    if (slides.includes(imgIdx)) { showToast('Already in carousel'); return }
    slides.push(imgIdx)
    setPlanItem(planIdx, { slides, type: 'carousel' })
    showToast(`Slide added (${slides.length})`)
  }, [state.plan, setPlanItem, showToast])

  const toggleLock = useCallback(idx => setPlanItem(idx, { locked: !state.plan[idx].locked }), [state.plan, setPlanItem])
  const clearSlot = useCallback(idx => { setPlanItem(idx, { imageIndex: null, slides: [], caption: '', panX: 50, panY: 50 }); if (inspectIdx === idx) setInspectIdx(null) }, [inspectIdx, setPlanItem])
  const removeSlide = useCallback((planIdx, slideIdx) => {
    const p = state.plan[planIdx]; if (!p?.slides || p.slides.length <= 1) { showToast('Cannot remove last slide'); return }
    const slides = p.slides.filter((_, i) => i !== slideIdx)
    setPlanItem(planIdx, { slides, imageIndex: slides[0], type: slides.length === 1 ? 'single' : 'carousel' })
  }, [state.plan, setPlanItem, showToast])

  const handleDoubleClick = useCallback((e, idx) => {
    e.stopPropagation()
    // Toggle pan mode for cover (slideIdx = null)
    if (panModeIdx?.postIdx === idx && panModeIdx?.slideIdx === null) {
      setPanModeIdx(null); showToast('Pan mode off')
    } else {
      setPanModeIdx({ postIdx: idx, slideIdx: null }); showToast('Pan mode — drag to reposition · dbl-click to exit')
    }
  }, [panModeIdx, showToast])

  const handleSlideDblClick = useCallback((e, postIdx, slideIdx) => {
    e.stopPropagation()
    if (panModeIdx?.postIdx === postIdx && panModeIdx?.slideIdx === slideIdx) {
      setPanModeIdx(null); showToast('Pan mode off')
    } else {
      setPanModeIdx({ postIdx, slideIdx }); showToast('Pan mode — drag slide to reposition · dbl-click to exit')
    }
  }, [panModeIdx, showToast])

  const startPan = useCallback((e, idx) => {
    if (panModeIdx?.postIdx !== idx || panModeIdx?.slideIdx !== null) return
    e.preventDefault(); e.stopPropagation()
    panDrag.current = { postIdx: idx, slideIdx: null, startX: e.clientX, startY: e.clientY, startPanX: state.plan[idx]?.panX || 50, startPanY: state.plan[idx]?.panY || 50, rect: e.currentTarget.getBoundingClientRect() }
  }, [panModeIdx, state.plan])

  const startSlidePan = useCallback((e, postIdx, slideIdx) => {
    if (panModeIdx?.postIdx !== postIdx || panModeIdx?.slideIdx !== slideIdx) return
    e.preventDefault(); e.stopPropagation()
    const p = state.plan[postIdx]
    const transforms = p.slideTransforms || {}
    const t = transforms[slideIdx] || { panX: 50, panY: 50 }
    panDrag.current = { postIdx, slideIdx, startX: e.clientX, startY: e.clientY, startPanX: t.panX, startPanY: t.panY, rect: e.currentTarget.getBoundingClientRect() }
  }, [panModeIdx, state.plan])

  const handleMouseMove = useCallback((e) => {
    if (!panDrag.current) return
    const { postIdx, slideIdx, startX, startY, startPanX, startPanY, rect } = panDrag.current
    const newPanX = Math.max(0, Math.min(100, startPanX - (e.clientX - startX) / rect.width * 100))
    const newPanY = Math.max(0, Math.min(100, startPanY - (e.clientY - startY) / rect.height * 100))
    if (slideIdx === null) {
      setPlanItem(postIdx, { panX: newPanX, panY: newPanY })
    } else {
      const p = state.plan[postIdx]
      const transforms = { ...(p.slideTransforms || {}) }
      transforms[slideIdx] = { panX: newPanX, panY: newPanY }
      setPlanItem(postIdx, { slideTransforms: transforms })
    }
  }, [setPlanItem, state.plan])

  const handleMouseUp = useCallback(() => { panDrag.current = null }, [])

  const usedIdxs = new Set()
  state.plan.forEach(p => { if (p.imageIndex) usedIdxs.add(p.imageIndex); (p.slides || []).forEach(idx => { if (idx) usedIdxs.add(idx) }) })
  const unassigned = state.images.filter((_, i) => !usedIdxs.has(i + 1))
  const portraits  = state.images.filter(i => i.orientation === 'portrait')
  const landscapes = state.images.filter(i => i.orientation === 'landscape')
  const squares    = state.images.filter(i => i.orientation === 'square')
  const allFilled  = state.plan.length > 0 && state.plan.every(p => p.imageIndex)
  const inspectedPost = inspectIdx !== null ? state.plan[inspectIdx] : null
  const thumbPx = Math.round(44 * thumbScale)

  const renderThumb = (img) => {
    const imgIdx = state.images.indexOf(img) + 1
    const isExcluded = excludedImgIds.has(img.id)
    const isHovered = hoveredThumb === img.id
    const title = isExcluded
      ? `${img.name} — excluded from planning`
      : img.visionDesc ? `${img.name}\n${img.visionDesc}` : img.name
    return (
      <div key={img.id}
        style={{ width: thumbPx, height: thumbPx, flexShrink: 0, borderRadius: 2, overflow: 'hidden', border: `1px solid ${isExcluded ? 'rgba(180,60,60,.6)' : img.visionDesc ? 'rgba(74,122,191,.4)' : 'var(--border)'}`, cursor: isExcluded ? 'default' : 'grab', position: 'relative', opacity: isExcluded ? 0.38 : 1, transition: 'opacity .15s, border-color .15s' }}
        draggable={!isExcluded}
        onDragStart={isExcluded ? undefined : e => { e.dataTransfer.setData('sidebar-img-id', img.id); e.dataTransfer.setData('unassigned-img', imgIdx); e.currentTarget.style.opacity = '.5' }}
        onDragEnd={e => e.currentTarget.style.opacity = '1'}
        onMouseEnter={() => setHoveredThumb(img.id)}
        onMouseLeave={() => setHoveredThumb(null)}
        title={title}>
        <img src={img.dataUrl} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {img.visionAnalyzing && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="spin" style={{ width: 8, height: 8, borderWidth: 1 }} />
          </div>
        )}
        {img.visionDesc && !isHovered && !isExcluded && !img.visionAnalyzing && (
          <span style={{ position: 'absolute', bottom: 1, left: 1, background: isWhiteBg(img) ? 'rgba(180,60,60,.85)' : 'rgba(74,122,191,.85)', color: '#fff', fontSize: 6, padding: '1px 3px', borderRadius: 1, fontFamily: 'var(--font-mono)' }}>
            {isWhiteBg(img) ? '⊘' : '✦'}
          </span>
        )}
        {img.orientation === 'landscape' && !isHovered && !isExcluded && !img.visionDesc && !img.visionAnalyzing && (
          <span style={{ position: 'absolute', bottom: 1, right: 1, background: 'rgba(74,122,191,.9)', color: '#fff', fontSize: 6, padding: '1px 2px', borderRadius: 1 }}>L</span>
        )}
        {(isHovered || isExcluded) && !img.visionAnalyzing && (
          <button onClick={e => { e.stopPropagation(); toggleExclude(img.id) }}
            style={{ position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: isExcluded ? 'rgba(74,122,191,.9)' : 'rgba(138,58,58,.88)', color: '#fff', border: 'none', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0, fontWeight: 'bold' }}>
            {isExcluded ? '+' : '–'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 88px)', overflow: 'hidden' }} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>

      {/* LEFT: Controls + Grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden', minWidth: 0 }}>
        <div className="card" style={{ padding: '12px 14px', flexShrink: 0 }}>
          <div className="row gap12" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field">
              <div className="field-label">Posts</div>
              <input className="input" type="number" min={1} max={60} value={postCount} onChange={e => setPostCount(parseInt(e.target.value) || 1)} style={{ width: 60, textAlign: 'center' }} />
            </div>
            <div className="field flex1">
              <div className="field-label">Mix</div>
              <select className="select" value={mix} onChange={e => setMix(e.target.value)}>
                <option value="mixed">Mixed</option>
                <option value="stills">Stills only</option>
                <option value="carousels">Carousels heavy</option>
              </select>
            </div>
            <div className="field">
              <div className="field-label">Global Format</div>
              <div style={{ display: 'flex', gap: 3 }}>
                {SIZE_OPTIONS.map(s => (
                  <button key={s.ratio} onClick={() => { setSize(s); set('postW', s.w); set('postH', s.h) }}
                    style={{ padding: '4px 7px', fontSize: 9, fontFamily: 'var(--font-mono)', background: size.ratio === s.ratio ? 'var(--silver-glow)' : 'none', border: `1px solid ${size.ratio === s.ratio ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: size.ratio === s.ratio ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer' }}>
                    {s.ratio}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={handleSetLayout}>✓ Set</button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handlePlanWithClaude} disabled={planning}>
              {planning ? <><span className="spin" /> Planning…</> : '✦ Plan with Claude'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              const data = state.plan.map(p => ({ ...p, imageName: p.imageIndex ? state.images[p.imageIndex - 1]?.name || '' : '', slideNames: (p.slides || []).map(idx => state.images[idx - 1]?.name || '') }))
              const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = 'KSS-Plan.json'; a.click(); showToast('Exported')
            }}>↓ Export</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowChecklist(true)} title="Generate AI shot checklist from your brief">
              📋 Shot List
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'
              input.onchange = e => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader()
                reader.onload = ev => { try {
                  const parsed = JSON.parse(ev.target.result)

                  // Handle both formats: legacy array OR new session object
                  const planData = Array.isArray(parsed) ? parsed : parsed.plan
                  if (!planData || !Array.isArray(planData)) { showToast('Invalid file — no plan data found'); return }

                  // If session object, restore context + queue too
                  if (!Array.isArray(parsed)) {
                    if (parsed.globalContext) { set('globalContext', parsed.globalContext); localStorage.setItem('kss_global_context', parsed.globalContext) }
                    if (parsed.queue) set('queue', parsed.queue)
                    if (parsed.captionNotes) set('captionNotes', parsed.captionNotes)
                  }

                  const nameToIdx = {}; state.images.forEach((img, i) => { nameToIdx[img.name] = i + 1 })
                  const restored = planData.map(p => { const post = { ...makeEmptyPost(), ...p }
                    if (p.imageName && nameToIdx[p.imageName]) post.imageIndex = nameToIdx[p.imageName]
                    else if (p.imageIndex && p.imageIndex <= state.images.length) post.imageIndex = p.imageIndex
                    else post.imageIndex = null
                    if (p.slideNames?.length) { post.slides = p.slideNames.map(n => nameToIdx[n]).filter(Boolean); if (!post.slides.length) post.slides = post.imageIndex ? [post.imageIndex] : [] } else if (post.imageIndex) post.slides = [post.imageIndex]
                    return post })
                  resetPlan(restored)
                  showToast(`Session loaded — ${restored.filter(p => p.imageIndex).length} posts matched ✓`)
                } catch (err) { showToast('Import failed: ' + err.message) } }; reader.readAsText(file) }; input.click()
            }}>↑ Import</button>
            <div className="row" style={{ gap: 3, marginLeft: 'auto', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>Grid</span>
              <button className="btn btn-ghost btn-xs" onClick={() => { setGridScale(0.45); setPostCount(c => Math.max(c, 9)) }} title="9-up overview">9</button>
              <button className="btn btn-ghost btn-xs" onClick={() => setGridScale(s => Math.max(0.3, +(s - 0.1).toFixed(2)))}>−</button>
              <span style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)', minWidth: 28, textAlign: 'center' }}>{Math.round(gridScale * 100)}%</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setGridScale(s => Math.min(2.0, +(s + 0.1).toFixed(2)))}>+</button>
            </div>
          </div>
          {allFilled && (
            <button className="confirm-plan-btn" style={{ marginTop: 10 }}
              onClick={() => { resetPlan(state.plan.map(p => p.imageIndex ? { ...p, locked: true } : p)); onTabChange('captions'); showToast('Plan locked — generate captions') }}>
              ✓ Plan complete — Generate Captions →
            </button>
          )}
        </div>

        {/* ── DIRECTOR CARD ── */}
        <div className="card" style={{ padding: '10px 14px', flexShrink: 0 }}>
          <div className="row" style={{ alignItems: 'center', cursor: 'pointer', userSelect: 'none' }} onClick={() => setDirectorOpen(o => !o)}>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--silver)', letterSpacing: 1, textTransform: 'uppercase' }}>
              {directorOpen ? '▼' : '▶'} Director
            </span>
          </div>
          {directorOpen && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Reference Links */}
              <div>
                <div style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>References</div>
                <div className="row" style={{ gap: 6 }}>
                  <input className="input" style={{ flex: 1, fontSize: 11 }} value={refLinkInput} onChange={e => setRefLinkInput(e.target.value)}
                    placeholder="Paste a URL…"
                    onKeyDown={e => { if (e.key === 'Enter' && refLinkInput.trim()) addReferenceLink(refLinkInput) }} />
                  <button className="btn btn-ghost btn-sm" onClick={() => addReferenceLink(refLinkInput)}>+ URL</button>
                  <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }} title="Upload a screenshot of your moodboard (Pinterest, etc.)">
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) addReferenceScreenshot(e.target.files[0]); e.target.value = '' }} />
                    + Screenshot
                  </label>
                </div>
                {referenceLinks.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                    {referenceLinks.map((ref, i) => {
                      const isObj = typeof ref === 'object'
                      const url = isObj ? ref.url : ref
                      const domain = isObj ? ref.domain : url
                      const analyzing = isObj ? ref.analyzing : false
                      const analysis = isObj ? ref.analysis : null
                      const error = isObj ? ref.error : null
                      const thumb = isObj ? ref.thumb : null
                      return (
                        <div key={i} style={{ background: 'var(--surface2)', border: `1px solid ${analysis ? 'var(--silver-border)' : error ? 'var(--red-dim)' : 'var(--border)'}`, borderRadius: 3, padding: '5px 8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {thumb && <img src={thumb} style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} alt="" />}
                            {analyzing && <span className="spin" style={{ width: 8, height: 8, borderWidth: 1 }} />}
                            {!analyzing && analysis && <span style={{ color: 'var(--green)', fontSize: 9 }}>✓</span>}
                            {url
                              ? <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text2)', textDecoration: 'none', flex: 1 }}>{domain}</a>
                              : <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text2)', flex: 1 }}>{domain}</span>
                            }
                            <button onClick={() => { const next = referenceLinks.filter((_, j) => j !== i); setReferenceLinks(next); localStorage.setItem('kss_ref_links', JSON.stringify(next)) }} style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', padding: 0, fontSize: 10 }}>×</button>
                          </div>
                          {analyzing && <div style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>Analysing layout…</div>}
                          {error && (
                            <div style={{ fontSize: 9, color: 'var(--red)', fontFamily: 'var(--font-mono)', marginTop: 3, lineHeight: 1.4 }}>
                              {error}
                              {error.includes('screenshot') && (
                                <label style={{ marginLeft: 6, color: 'var(--silver)', textDecoration: 'underline', cursor: 'pointer' }}>
                                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) { const next = referenceLinks.filter((_, j) => j !== i); setReferenceLinks(next); localStorage.setItem('kss_ref_links', JSON.stringify(next)); addReferenceScreenshot(e.target.files[0]) }; e.target.value = '' }} />
                                  Upload now
                                </label>
                              )}
                            </div>
                          )}
                          {analysis && <div style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginTop: 3, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{analysis}</div>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {/* Planning Notes */}
              <div>
                <div style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>Planning Notes</div>
                <textarea className="input" rows={3} style={{ width: '100%', resize: 'none', fontSize: 11 }}
                  value={planningNotes}
                  placeholder="Director's notes — e.g. open with the black dress editorial, group architecture shots together…"
                  onChange={e => {
                    setPlanningNotes(e.target.value)
                    clearTimeout(notesTimer.current)
                    notesTimer.current = setTimeout(() => localStorage.setItem('kss_plan_notes', e.target.value), 300)
                  }} />
              </div>
            </div>
          )}
        </div>

        {/* ── REFINE CHAT ── */}
        {chatHistory.length > 0 && (
          <div className="card" style={{ padding: '10px 14px', flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Refine with Claude</div>
            {chatHistory.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, maxHeight: 90, overflowY: 'auto' }}>
                {chatHistory.slice(-6).map((msg, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '80%', padding: '4px 8px', borderRadius: 3, fontSize: 10, lineHeight: 1.4, fontFamily: msg.role === 'claude' ? 'var(--font-mono)' : 'var(--font-body)', background: msg.role === 'user' ? 'var(--surface2)' : 'var(--surface)', color: msg.role === 'user' ? 'var(--text)' : 'var(--silver)', border: '1px solid var(--border)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatHistory.length > 6 && <div style={{ fontSize: 9, color: 'var(--mute2)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>— scroll up for more —</div>}
              </div>
            )}
            <div className="row" style={{ gap: 6 }}>
              <input className="input" style={{ flex: 1, fontSize: 11 }} value={refineInput} onChange={e => setRefineInput(e.target.value)}
                placeholder="Refine the plan — e.g. group the architecture shots…"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleRefine() }}
                disabled={refining} />
              <button className="btn btn-ghost btn-sm" onClick={handleRefine} disabled={refining || !refineInput.trim()}>
                {refining ? <span className="spin" /> : '→'}
              </button>
            </div>
          </div>
        )}

        <div ref={gridScrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 160 }}>
          {state.plan.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--mute)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>Set posts and click ✓ Set — or use Plan with Claude</div>
          ) : (
            <>
              <div style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>Instagram grid · drag to reorder · dbl-click image to pan</span>
                <span>{state.plan.length} posts</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: Math.round(3 * gridScale), width: `${Math.round(gridScale * 100)}%` }}>
                {state.plan.map((p, i) => {
                  const img = imgByIdx(p.imageIndex) || imgByIdx(p.slides?.[0]) || null
                  const isEmpty = !img
                  const igNum = state.plan.length - i
                  const slides = p.slides?.length || 1
                  const isPanMode = panModeIdx?.postIdx === i && panModeIdx?.slideIdx === null
                  const isInspected = inspectIdx === i
                  const borderColor = isInspected ? 'var(--silver)' : isPanMode ? 'var(--silver)' : dragOver === i ? 'var(--silver)' : 'var(--border)'
                  return (
                    <div key={i} style={{ position: 'relative', overflow: 'hidden', borderRadius: 3, cursor: isPanMode ? 'grab' : isEmpty ? 'default' : 'pointer', background: 'var(--surface)', border: `1px solid ${borderColor}`, aspectRatio: getCellRatio(p, size), transition: 'border-color .15s' }}
                      draggable={!isEmpty && !p.locked && !isPanMode}
                      onDragStart={e => { e.dataTransfer.setData('plan-cell-idx', i); e.currentTarget.style.opacity = '.5' }}
                      onDragEnd={e => e.currentTarget.style.opacity = '1'}
                      onDragOver={e => { e.preventDefault(); setDragOver(i) }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={e => handleCellDrop(e, i)}
                      onClick={() => !isEmpty && !isPanMode && setInspectIdx(i)}
                      onDoubleClick={e => !isEmpty && handleDoubleClick(e, i)}
                      onMouseDown={e => !isEmpty && startPan(e, i)}>
                      {isEmpty ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
                          <div style={{ fontSize: 8, color: 'var(--mute2)', fontFamily: 'var(--font-mono)' }}>#{igNum}</div>
                          <div style={{ fontSize: Math.round(18 * gridScale), color: 'var(--mute2)', opacity: .3, lineHeight: 1 }}>+</div>
                          <div style={{ fontSize: 8, color: 'var(--mute2)' }}>drag image</div>
                        </div>
                      ) : (
                        <>
                          <img src={img.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', objectPosition: `${p.panX || 50}% ${p.panY || 50}%`, transform: getImgTransform(p) }} />
                          {p.locked && <span style={{ position: 'absolute', top: 3, left: 3, fontSize: 9 }}>🔒</span>}
                          <div style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,.7)', color: 'var(--silver)', fontSize: 7, padding: '1px 4px', borderRadius: 2, fontFamily: 'var(--font-mono)' }}>
                            {p.type}{p.type === 'carousel' && slides > 1 ? ` ▤${slides}` : ''}
                            {p.formatOverride ? ` · ${p.formatOverride}` : ''}
                          </div>
                          {!p.caption && <div style={{ position: 'absolute', bottom: 3, left: 3, background: 'rgba(138,58,58,.85)', color: '#fff', fontSize: 7, padding: '1px 4px', borderRadius: 2 }}>no cap</div>}
                          {p.type === 'carousel' && p.slides?.length > 1 && (
                            <button
                              onClick={e => { e.stopPropagation(); setCarouselPreview(i) }}
                              style={{ position: 'absolute', bottom: 3, right: 3, background: 'rgba(0,0,0,.7)', border: '1px solid var(--silver-border)', borderRadius: 3, color: 'var(--silver)', fontSize: 7, padding: '2px 5px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                              preview
                            </button>
                          )}
                          {isPanMode && (
                            <div style={{ position: 'absolute', inset: 0, border: '2px solid var(--silver)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.15)', pointerEvents: 'none' }}>
                              <div style={{ background: 'rgba(0,0,0,.75)', color: 'var(--silver)', fontSize: 8, padding: '3px 8px', borderRadius: 10, fontFamily: 'var(--font-mono)' }}>drag · dbl-click to exit</div>
                            </div>
                          )}
                          <div className="grid-cell-hover" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,.8))', opacity: 0, transition: 'opacity .2s', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 5, gap: 3 }}>
                            <div style={{ fontSize: 8, color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>#{igNum} · {p.theme || p.type}</div>
                            <div style={{ display: 'flex', gap: 3 }}>
                              {[['inspect', () => setInspectIdx(i)], [p.locked ? '🔓' : '🔒', () => toggleLock(i)], ['✕', () => clearSlot(i)]].map(([label, action], li) => (
                                <button key={li} onClick={e => { e.stopPropagation(); action() }}
                                  style={{ padding: '2px 5px', fontSize: 7, background: 'rgba(0,0,0,.6)', border: '1px solid var(--border2)', borderRadius: 2, color: li === 0 ? 'var(--silver)' : 'var(--text2)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* RIGHT: Image Bank + Inspector */}
      <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>

        {/* Image Bank */}
        <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: inspectIdx !== null ? '0 0 auto' : 1, maxHeight: inspectIdx !== null ? '44%' : '100%' }}>
          <div className="row" style={{ marginBottom: 8, gap: 5 }}>
            <div style={{ display: 'flex', gap: 3, flex: 1 }}>
              {[['all', `All (${state.images.length})`], ['unassigned', `Free (${unassigned.length})`]].map(([tab, label]) => (
                <button key={tab} onClick={() => setImageTab(tab)}
                  style={{ padding: '3px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', background: imageTab === tab ? 'var(--silver-glow)' : 'none', border: `1px solid ${imageTab === tab ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: imageTab === tab ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer' }}>
                  {label}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost btn-xs" onClick={() => setThumbScale(s => Math.max(0.5, +(s - 0.2).toFixed(1)))}>−</button>
            <button className="btn btn-ghost btn-xs" onClick={() => setThumbScale(s => Math.min(2.5, +(s + 0.2).toFixed(1)))}>+</button>
          </div>
          {state.images.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <button
                className="btn btn-ghost btn-xs"
                style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 9, justifyContent: 'center' }}
                onClick={analyzeImages}
                disabled={!!analysisProgress}
                title="Run Claude Vision on all images so the planner knows subject, background, and mood">
                {analysisProgress
                  ? `Analysing… ${analysisProgress.done}/${analysisProgress.total}`
                  : `✦ Analyse (${state.images.filter(i => i.visionDesc).length}/${state.images.length})`}
              </button>
              {(() => {
                const whiteBgImgs = state.images.filter(img => isWhiteBg(img) && !excludedImgIds.has(img.id))
                if (!whiteBgImgs.length) return null
                return (
                  <button
                    className="btn btn-ghost btn-xs"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(180,60,60,.9)', borderColor: 'rgba(180,60,60,.4)' }}
                    onClick={() => setExcludedImgIds(prev => { const next = new Set(prev); whiteBgImgs.forEach(img => next.add(img.id)); return next })}
                    title={`Exclude ${whiteBgImgs.length} white-background images from planning`}>
                    ⊘ white bg ({whiteBgImgs.length})
                  </button>
                )
              })()}
            </div>
          )}
          {excludedImgIds.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, padding: '3px 6px', background: 'rgba(138,58,58,.12)', border: '1px solid rgba(180,60,60,.3)', borderRadius: 3 }}>
              <span style={{ fontSize: 9, color: 'var(--red, #c06)', fontFamily: 'var(--font-mono)' }}>{excludedImgIds.size} excluded from planning</span>
              <button onClick={() => setExcludedImgIds(new Set())} style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 9, fontFamily: 'var(--font-mono)', padding: 0 }}>clear</button>
            </div>
          )}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {imageTab === 'all' ? (
              state.images.length === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--mute)', textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-mono)' }}>No images — upload or import from Drive</div>
              ) : (
                [{ label: 'Portrait', imgs: portraits }, { label: 'Landscape', imgs: landscapes }, { label: 'Square', imgs: squares }].filter(g => g.imgs.length).map(group => (
                  <div key={group.label} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 5, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{group.label}</span><span style={{ color: 'var(--mute2)' }}>{group.imgs.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>{group.imgs.map(renderThumb)}</div>
                  </div>
                ))
              )
            ) : (
              unassigned.length === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--silver)', textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-mono)' }}>All images assigned ✓</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>{unassigned.map(renderThumb)}</div>
              )
            )}
          </div>
        </div>

        {/* Inspector */}
        {inspectIdx !== null && inspectedPost && (
          <div className="card" style={{ padding: 12, flex: 1, overflow: 'auto' }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500, flex: 1 }}>Post #{state.plan.length - inspectIdx}</div>
              <button onClick={() => setInspectIdx(null)} style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>

            {/* Type */}
            <div className="row" style={{ gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
              {['single', 'carousel', 'reel'].map(t => (
                <button key={t} onClick={() => setPlanItem(inspectIdx, { type: t })}
                  style={{ padding: '3px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', background: inspectedPost.type === t ? 'var(--silver-glow)' : 'var(--surface2)', border: `1px solid ${inspectedPost.type === t ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: inspectedPost.type === t ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer' }}>
                  {t}
                </button>
              ))}
              <button onClick={() => toggleLock(inspectIdx)}
                style={{ padding: '3px 8px', fontSize: 9, marginLeft: 'auto', background: inspectedPost.locked ? 'var(--green-dim)' : 'none', border: `1px solid ${inspectedPost.locked ? 'var(--green)' : 'var(--border)'}`, borderRadius: 2, color: inspectedPost.locked ? 'var(--green)' : 'var(--mute)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                {inspectedPost.locked ? '🔒' : '🔓'}
              </button>
            </div>

            {/* Format override */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 5 }}>Format override</div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {POST_FORMATS.map(f => (
                  <button key={f.label} onClick={() => setPlanItem(inspectIdx, { formatOverride: f.ratio })}
                    style={{ padding: '3px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', background: inspectedPost.formatOverride === f.ratio ? 'var(--silver-glow)' : 'none', border: `1px solid ${inspectedPost.formatOverride === f.ratio ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: inspectedPost.formatOverride === f.ratio ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer' }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Rotate + flip */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 5 }}>Transform</div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {[
                  ['↺ 90°', () => setPlanItem(inspectIdx, { rotate: ((inspectedPost.rotate || 0) - 90 + 360) % 360 })],
                  ['↻ 90°', () => setPlanItem(inspectIdx, { rotate: ((inspectedPost.rotate || 0) + 90) % 360 })],
                  ['⇔ Flip H', () => setPlanItem(inspectIdx, { flipH: !inspectedPost.flipH })],
                  ['⇕ Flip V', () => setPlanItem(inspectIdx, { flipV: !inspectedPost.flipV })],
                  ['Reset', () => setPlanItem(inspectIdx, { rotate: 0, flipH: false, flipV: false, panX: 50, panY: 50 })],
                ].map(([label, action]) => (
                  <button key={label} onClick={action}
                    style={{ padding: '3px 8px', fontSize: 9, fontFamily: 'var(--font-mono)', background: 'none', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text2)', cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Slides */}
            {inspectedPost.slides?.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Slides ({inspectedPost.slides.length})</span>
                  <span style={{ color: 'var(--text-3)', fontSize: 8 }}>dbl-click to pan</span>
                </div>

                {/* Expanded view for active pan slide */}
                {panModeIdx?.postIdx === inspectIdx && panModeIdx?.slideIdx !== null && (() => {
                  const si = panModeIdx.slideIdx
                  const sImg = imgByIdx(inspectedPost.slides[si])
                  const transforms = inspectedPost.slideTransforms || {}
                  const t = transforms[si] || { panX: 50, panY: 50 }
                  return (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 8, color: 'var(--silver)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                        Slide {si + 1} — drag to reposition · dbl-click to exit
                      </div>
                      <div
                        style={{ position: 'relative', width: '100%', aspectRatio: '4/5', borderRadius: 4, overflow: 'hidden', border: '2px solid var(--silver)', cursor: 'grab' }}
                        onMouseDown={e => startSlidePan(e, inspectIdx, si)}
                      >
                        {sImg && <img src={sImg.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${t.panX}% ${t.panY}%` }} />}
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                          <div style={{ background: 'rgba(0,0,0,.6)', color: 'var(--silver)', fontSize: 9, padding: '4px 12px', borderRadius: 12, fontFamily: 'var(--font-mono)', border: '1px solid var(--silver-edge)' }}>
                            ⤢ drag to pan
                          </div>
                        </div>
                        <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,.75)', color: 'var(--silver)', fontSize: 8, padding: '2px 6px', borderRadius: 3, fontFamily: 'var(--font-mono)' }}>
                          {Math.round(t.panX)}% / {Math.round(t.panY)}%
                        </div>
                        <button
                          onClick={() => setPanModeIdx(null)}
                          style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.75)', border: '1px solid var(--silver-edge)', borderRadius: 3, color: 'var(--silver)', fontSize: 9, padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                          done
                        </button>
                      </div>
                    </div>
                  )
                })()}

                {/* Slide thumbnail strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
                  {inspectedPost.slides.map((idx, si) => {
                    const sImg = imgByIdx(idx)
                    const transforms = inspectedPost.slideTransforms || {}
                    const t = transforms[si] || { panX: 50, panY: 50 }
                    const isSlidePanMode = panModeIdx?.postIdx === inspectIdx && panModeIdx?.slideIdx === si
                    return (
                      <div key={si} style={{ position: 'relative', aspectRatio: '4/5', borderRadius: 2, overflow: 'hidden', border: `2px solid ${isSlidePanMode ? 'var(--silver)' : 'var(--border)'}`, cursor: 'pointer', transition: 'border-color .15s' }}
                        onDoubleClick={e => handleSlideDblClick(e, inspectIdx, si)}
                        onMouseDown={e => isSlidePanMode && startSlidePan(e, inspectIdx, si)}>
                        {sImg && <img src={sImg.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${t.panX}% ${t.panY}%` }} />}
                        <div style={{ position: 'absolute', bottom: 2, left: 2, background: 'rgba(0,0,0,.75)', color: isSlidePanMode ? 'var(--silver)' : 'var(--text-2)', fontSize: 7, padding: '1px 4px', borderRadius: 2, fontFamily: 'var(--font-mono)' }}>
                          {isSlidePanMode ? '⤢' : si + 1}
                        </div>
                        {!isSlidePanMode && inspectedPost.slides.length > 1 && (
                          <button onClick={e => { e.stopPropagation(); removeSlide(inspectIdx, si) }}
                            style={{ position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: 'rgba(138,58,58,.85)', color: '#fff', border: 'none', fontSize: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Add unassigned */}
            {unassigned.length > 0 && (
              <>
                <div style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 5 }}>Add to carousel</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {unassigned.slice(0, 12).map(img => {
                    const imgIdx = state.images.indexOf(img) + 1
                    return (
                      <div key={img.id} style={{ width: 38, height: 38, borderRadius: 2, overflow: 'hidden', border: '1px dashed var(--border2)', cursor: 'pointer', flexShrink: 0 }}
                        onClick={() => appendSlide(inspectIdx, imgIdx)} title={img.name}>
                        <img src={img.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    )
                  })}
                  {unassigned.length > 12 && <div style={{ fontSize: 9, color: 'var(--mute)', alignSelf: 'center', fontFamily: 'var(--font-mono)' }}>+{unassigned.length - 12}</div>}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Carousel preview modal */}
      {carouselPreview !== null && state.plan[carouselPreview] && (
        <CarouselModal
          post={state.plan[carouselPreview]}
          images={state.images}
          postNum={state.plan.length - carouselPreview}
          onClose={() => setCarouselPreview(null)}
        />
      )}

      {/* Shoot checklist */}
      {showChecklist && <ShootChecklist onClose={() => setShowChecklist(false)} showToast={showToast} />}
    </div>
  )
}
