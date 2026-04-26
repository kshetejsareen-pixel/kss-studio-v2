import { useState, useCallback, useRef } from 'react'
import { useStore, claudeCall, M_HAIKU } from '../store.jsx'
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
  const { state, set, resetPlan, setPlanItem } = useStore()
  const [postCount, setPostCount]   = useState(6)
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
  const panDrag = useRef(null)

  const imgByIdx = useCallback(idx => {
    if (!idx || idx < 1 || idx > state.images.length) return null
    return state.images[idx - 1] || null
  }, [state.images])

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
    const imgDesc = state.images.slice(0, 30).map((img, i) => `${i + 1}. ${img.name} [${img.orientation}]`).join('\n')
    const perPost = totalImgs / postCount
    const distributionNote = perPost >= 2
      ? `${totalImgs} images across ${postCount} posts — use CAROUSELS (~${Math.ceil(perPost)} slides each).`
      : `${totalImgs} images, ${postCount} posts — 1 image per post.`
    const landscapes = state.images.filter(i => i.orientation === 'landscape').length
    const orientNote = landscapes > 0 ? `IMPORTANT: Never mix landscape and portrait in the same carousel.` : ''
    const system = `You are a luxury Instagram content strategist for Kshetej Sareen Studios (${handle}). Plan image assignments only. Respond with valid JSON only.`
    const prompt = `Plan an Instagram calendar. ${totalImgs} images:\n${imgDesc}\n\nContext: ${globalCtx || 'None'}\nPosts needed: ${postCount}\nPost format: ${ratio}\n${distributionNote}\n${orientNote}\n\nReturn ONLY valid JSON array:\n[{"imageIndex":1,"slides":[1,3],"type":"single|carousel|reel","theme":"short label","notes":""}]`
    try {
      const raw = await claudeCall(key, system, prompt, M_HAIKU, 4000)
      // Extract JSON array from response — handle any surrounding text
      const match = raw.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('No JSON array in response')
      const parsed = JSON.parse(match[0])
      resetPlan(parsed.map(p => ({ ...makeEmptyPost(), imageIndex: p.imageIndex || null, slides: p.slides || [p.imageIndex].filter(Boolean), type: p.type || 'single', theme: p.theme || '', notes: p.notes || '' })))
      set('postW', size.w); set('postH', size.h)
      showToast(`Layout ready — ${parsed.length} posts`)
    } catch (e) { showToast('Error: ' + e.message); console.error(e) }
    finally { setPlanning(false) }
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
    return (
      <div key={img.id} style={{ width: thumbPx, height: thumbPx, flexShrink: 0, borderRadius: 2, overflow: 'hidden', border: '1px solid var(--border)', cursor: 'grab', position: 'relative' }}
        draggable onDragStart={e => { e.dataTransfer.setData('sidebar-img-id', img.id); e.dataTransfer.setData('unassigned-img', imgIdx); e.currentTarget.style.opacity = '.5' }}
        onDragEnd={e => e.currentTarget.style.opacity = '1'} title={img.name}>
        <img src={img.dataUrl} alt={img.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {img.orientation === 'landscape' && <span style={{ position: 'absolute', bottom: 1, right: 1, background: 'rgba(74,122,191,.9)', color: '#fff', fontSize: 6, padding: '1px 2px', borderRadius: 1 }}>L</span>}
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
                reader.onload = ev => { try { const parsed = JSON.parse(ev.target.result); if (!Array.isArray(parsed)) { showToast('Invalid file'); return }
                  const nameToIdx = {}; state.images.forEach((img, i) => { nameToIdx[img.name] = i + 1 })
                  const restored = parsed.map(p => { const post = { ...makeEmptyPost(), ...p, date: '', time: '' }
                    if (p.imageName && nameToIdx[p.imageName]) post.imageIndex = nameToIdx[p.imageName]
                    else if (p.imageIndex && p.imageIndex <= state.images.length) post.imageIndex = p.imageIndex
                    else post.imageIndex = null
                    if (p.slideNames?.length) { post.slides = p.slideNames.map(n => nameToIdx[n]).filter(Boolean); if (!post.slides.length) post.slides = post.imageIndex ? [post.imageIndex] : [] } else if (post.imageIndex) post.slides = [post.imageIndex]
                    return post })
                  resetPlan(restored); showToast(`Imported — ${restored.filter(p => p.imageIndex).length} matched`)
                } catch (err) { showToast('Import failed: ' + err.message) } }; reader.readAsText(file) }; input.click()
            }}>↑ Import</button>
            <div className="row" style={{ gap: 3, marginLeft: 'auto', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>Grid</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setGridScale(s => Math.max(0.5, +(s - 0.15).toFixed(2)))}>−</button>
              <button className="btn btn-ghost btn-xs" onClick={() => setGridScale(s => Math.min(1.8, +(s + 0.15).toFixed(2)))}>+</button>
            </div>
          </div>
          {allFilled && (
            <button className="confirm-plan-btn" style={{ marginTop: 10 }}
              onClick={() => { resetPlan(state.plan.map(p => p.imageIndex ? { ...p, locked: true } : p)); onTabChange('captions'); showToast('Plan locked — generate captions') }}>
              ✓ Plan complete — Generate Captions →
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {state.plan.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--mute)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>Set posts and click ✓ Set — or use Plan with Claude</div>
          ) : (
            <>
              <div style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>Instagram grid · drag to reorder · dbl-click image to pan</span>
                <span>{state.plan.length} posts</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: Math.round(3 * gridScale), width: `${Math.round(gridScale * 100)}%`, minWidth: '60%' }}>
                {state.plan.map((p, i) => {
                  const img = p.imageIndex ? imgByIdx(p.imageIndex) : null
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
