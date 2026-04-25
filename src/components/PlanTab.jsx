import { useState, useCallback, useRef } from 'react'
import { useStore, claudeCall, M_HAIKU } from '../store.jsx'

const SIZE_OPTIONS = [
  { label: '1:1 Square',    ratio: '1:1',  w: 1080, h: 1080 },
  { label: '4:5 Portrait ★', ratio: '4:5', w: 1080, h: 1350 },
  { label: '9:16 Story',    ratio: '9:16', w: 1080, h: 1920 },
  { label: '16:9 Wide',     ratio: '16:9', w: 1080, h: 608  },
]

function makeEmptyPost() {
  return { imageIndex: null, slides: [], type: 'single', caption: '', theme: '', notes: '', locked: false, panX: 50, panY: 50 }
}

export default function PlanTab({ showToast, onTabChange }) {
  const { state, set, resetPlan, setPlanItem } = useStore()
  const [postCount, setPostCount] = useState(6)
  const [size, setSize] = useState(SIZE_OPTIONS[1])
  const [mix, setMix] = useState('mixed')
  const [planning, setPlanning] = useState(false)
  const [inspectIdx, setInspectIdx] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const panDrag = useRef(null)

  const imgByIdx = useCallback(idx => {
    if (!idx || idx < 1 || idx > state.images.length) return null
    return state.images[idx - 1] || null
  }, [state.images])

  // ── Set layout ──
  const handleSetLayout = () => {
    const current = state.plan.length
    if (current === postCount) { showToast(`Already ${postCount} slots`); return }
    if (current < postCount) {
      const toAdd = postCount - current
      const newPlan = [...state.plan, ...Array.from({ length: toAdd }, makeEmptyPost)]
      resetPlan(newPlan)
    } else {
      const losing = state.plan.slice(postCount).filter(p => p.imageIndex).length
      if (losing > 0 && !confirm(`Reducing to ${postCount} slots will remove ${losing} filled post${losing > 1 ? 's' : ''}. Continue?`)) return
      resetPlan(state.plan.slice(0, postCount))
    }
    showToast(`Layout set to ${postCount} posts ✓`)
  }

  // ── Plan with Claude ──
  const handlePlanWithClaude = async () => {
    if (!state.images.length) { showToast('Upload images first'); return }
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings first'); return }

    setPlanning(true)
    const count = postCount
    const totalImgs = state.images.length
    const handle = state.settings.handle || '@kshetejsareenstudios'
    const globalCtx = state.globalContext
    const ratio = `${size.w}×${size.h}`

    const imgDesc = state.images.slice(0, 30).map((img, i) =>
      `${i + 1}. ${img.name} [${img.orientation}]`
    ).join('\n')

    const perPost = totalImgs / count
    let distributionNote = ''
    if (perPost >= 2) distributionNote = `SMART DISTRIBUTION: ${totalImgs} images across ${count} posts (~${Math.ceil(perPost)} slides each). Use CAROUSELS.`
    else if (perPost >= 1.2) distributionNote = `Mix carousels (2-3 slides) and singles to cover all ${totalImgs} images.`
    else distributionNote = `${totalImgs} images, ${count} posts — 1 image per post.`

    const landscapes = state.images.filter(i => i.orientation === 'landscape').length
    const portraits = state.images.filter(i => i.orientation === 'portrait').length
    const orientNote = landscapes > 0 && portraits > 0
      ? `CRITICAL: Never mix landscape and portrait images in the same carousel. Group by orientation.`
      : ''

    const system = `You are a luxury Instagram content strategist for Kshetej Sareen Studios (${handle}). Plan image assignments ONLY — captions generated separately. Respond with valid JSON only.`
    const prompt = `Plan an Instagram calendar. ${totalImgs} images:\n${imgDesc}\n\nContext: ${globalCtx || 'None'}\nPosts needed: ${count}\nPost format: ${ratio}\n${distributionNote}\n${orientNote}\n\nVISUAL DIVERSITY: Never place similar images adjacent. Alternate orientations, distances, subjects across grid rows.\n\nReturn ONLY valid JSON array:\n[{"imageIndex":1,"slides":[1,3],"type":"single|carousel|reel","theme":"short label","notes":""}]`

    try {
      const raw = await claudeCall(key, system, prompt, M_HAIKU, 4000)
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
      const newPlan = parsed.map(p => ({
        ...makeEmptyPost(),
        imageIndex: p.imageIndex || null,
        slides: p.slides || [p.imageIndex].filter(Boolean),
        type: p.type || 'single',
        theme: p.theme || '',
        notes: p.notes || '',
      }))
      resetPlan(newPlan)
      set('postW', size.w)
      set('postH', size.h)
      showToast(`Layout ready — ${newPlan.length} posts ✓`)
    } catch (e) {
      showToast('Error: ' + e.message)
      console.error(e)
    } finally {
      setPlanning(false)
    }
  }

  // ── Drag and drop ──
  const handleCellDrop = useCallback((e, cellIdx) => {
    e.preventDefault()
    setDragOver(null)
    const p = state.plan[cellIdx]
    const isEmpty = !p?.imageIndex

    // Sidebar image
    const sidebarId = e.dataTransfer.getData('sidebar-img-id')
    if (sidebarId) {
      const imgIdx = state.images.findIndex(im => im.id === sidebarId) + 1
      if (imgIdx > 0) {
        if (isEmpty) {
          const newPlan = [...state.plan]
          newPlan[cellIdx] = { ...newPlan[cellIdx], imageIndex: imgIdx, slides: [imgIdx], type: 'single' }
          resetPlan(newPlan)
          setInspectIdx(cellIdx)
          showToast(`Slot ${state.plan.length - cellIdx} filled ✓`)
        } else if (e.shiftKey || p.type === 'carousel') {
          appendSlide(cellIdx, imgIdx)
        } else {
          const newPlan = [...state.plan]
          newPlan[cellIdx] = { ...newPlan[cellIdx], imageIndex: imgIdx, slides: [imgIdx] }
          resetPlan(newPlan)
          showToast('Cover swapped ✓ · shift+drop to add as slide')
        }
      }
      return
    }

    // Grid reorder — swap
    const from = parseInt(e.dataTransfer.getData('plan-cell-idx'))
    if (!isNaN(from) && from !== cellIdx) {
      if (state.plan[from]?.locked || state.plan[cellIdx]?.locked) {
        showToast('Cannot move — a locked post is involved')
        return
      }
      const newPlan = [...state.plan]
      ;[newPlan[from], newPlan[cellIdx]] = [newPlan[cellIdx], newPlan[from]]
      if (inspectIdx === from) setInspectIdx(cellIdx)
      else if (inspectIdx === cellIdx) setInspectIdx(from)
      resetPlan(newPlan)
      showToast('Posts swapped ✓')
    }
  }, [state.plan, state.images, inspectIdx, resetPlan, showToast])

  const appendSlide = useCallback((planIdx, imgIdx) => {
    const p = state.plan[planIdx]
    if (!p) return
    const slides = p.slides?.length ? [...p.slides] : [p.imageIndex].filter(Boolean)
    if (slides.includes(imgIdx)) { showToast('Already in carousel'); return }
    slides.push(imgIdx)
    setPlanItem(planIdx, { slides, type: 'carousel' })
    showToast(`Slide added (${slides.length} total) ✓`)
  }, [state.plan, setPlanItem, showToast])

  const toggleLock = useCallback(idx => {
    setPlanItem(idx, { locked: !state.plan[idx].locked })
  }, [state.plan, setPlanItem])

  const clearSlot = useCallback(idx => {
    setPlanItem(idx, { imageIndex: null, slides: [], caption: '', panX: 50, panY: 50 })
    if (inspectIdx === idx) setInspectIdx(null)
  }, [inspectIdx, setPlanItem])

  const removeSlide = useCallback((planIdx, slideIdx) => {
    const p = state.plan[planIdx]
    if (!p?.slides || p.slides.length <= 1) { showToast('Cannot remove last slide'); return }
    const slides = p.slides.filter((_, i) => i !== slideIdx)
    setPlanItem(planIdx, { slides, imageIndex: slides[0], type: slides.length === 1 ? 'single' : 'carousel' })
  }, [state.plan, setPlanItem, showToast])

  // ── Image pan (Alt+drag) ──
  const startPan = useCallback((e, idx) => {
    if (!e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    panDrag.current = {
      idx,
      startX: e.clientX, startY: e.clientY,
      startPanX: state.plan[idx]?.panX || 50,
      startPanY: state.plan[idx]?.panY || 50,
      rect: e.currentTarget.getBoundingClientRect(),
    }
  }, [state.plan])

  // Global mouse move/up for pan
  const handleMouseMove = useCallback((e) => {
    if (!panDrag.current) return
    const { idx, startX, startY, startPanX, startPanY, rect } = panDrag.current
    const dx = (e.clientX - startX) / rect.width * 100
    const dy = (e.clientY - startY) / rect.height * 100
    setPlanItem(idx, {
      panX: Math.max(0, Math.min(100, startPanX - dx)),
      panY: Math.max(0, Math.min(100, startPanY - dy)),
    })
  }, [setPlanItem])

  const handleMouseUp = useCallback(() => { panDrag.current = null }, [])

  // ── All filled check ──
  const allFilled = state.plan.length > 0 && state.plan.every(p => p.imageIndex)

  // ── Unassigned images ──
  const usedIdxs = new Set()
  state.plan.forEach(p => {
    if (p.imageIndex) usedIdxs.add(p.imageIndex)
    ;(p.slides || []).forEach(idx => { if (idx) usedIdxs.add(idx) })
  })
  const unassigned = state.images.filter((_, i) => !usedIdxs.has(i + 1))

  const inspectedPost = inspectIdx !== null ? state.plan[inspectIdx] : null

  return (
    <div onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>

      {/* ── PLAN CONTROLS ── */}
      <div className="card">
        <div className="card-title">Content Planner</div>
        <div className="card-sub">Build your layout — drag images from the sidebar or use Plan with Claude</div>

        <div className="row gap12" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          <div className="field">
            <div className="field-label">No. of Posts</div>
            <input
              className="input"
              type="number"
              min={1} max={60}
              value={postCount}
              onChange={e => setPostCount(parseInt(e.target.value) || 1)}
              style={{ width: 80, textAlign: 'center' }}
            />
          </div>
          <div className="field flex1">
            <div className="field-label">Content Mix</div>
            <select className="select" value={mix} onChange={e => setMix(e.target.value)}>
              <option value="mixed">Mixed — stills, carousels, reels</option>
              <option value="stills">Stills only</option>
              <option value="carousels">Carousels heavy</option>
              <option value="reels">Reels heavy</option>
            </select>
          </div>
          <div className="field" style={{ alignSelf: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={handleSetLayout}>✓ Set Layout</button>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <div className="field-label">Post Format</div>
          <div className="size-pills mt8">
            {SIZE_OPTIONS.map(s => (
              <button
                key={s.ratio}
                className={`size-pill ${size.ratio === s.ratio ? 'active' : ''}`}
                onClick={() => {
                  setSize(s)
                  set('postW', s.w)
                  set('postH', s.h)
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="size-note">{size.ratio} ({size.w}×{size.h})</div>
        </div>

        {/* Primary action */}
        <button
          className="btn btn-primary btn-full"
          onClick={handlePlanWithClaude}
          disabled={planning}
          style={{ marginBottom: 8 }}
        >
          {planning ? <><span className="spin" /> Building layout…</> : '✦ Plan with Claude'}
        </button>

        {/* Secondary actions */}
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const data = JSON.stringify(state.plan, null, 2)
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
            a.download = 'KSS-Plan.json'
            a.click()
            showToast('Plan exported ✓')
          }}>↓ Export</button>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.json,application/json'
            input.onchange = e => {
              const file = e.target.files[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = ev => {
                try {
                  const parsed = JSON.parse(ev.target.result)
                  if (!Array.isArray(parsed)) { showToast('Invalid plan file'); return }
                  resetPlan(parsed.map(p => ({ ...makeEmptyPost(), ...p, date: '', time: '' })))
                  showToast(`Plan imported — ${parsed.length} posts ✓`)
                } catch { showToast('Import failed') }
              }
              reader.readAsText(file)
            }
            input.click()
          }}>↑ Import</button>
        </div>

        {/* Confirm + go to captions */}
        {allFilled && (
          <button
            className="confirm-plan-btn"
            onClick={() => {
              const newPlan = state.plan.map(p => p.imageIndex ? { ...p, locked: true } : p)
              resetPlan(newPlan)
              onTabChange('captions')
              showToast('Plan locked ✓ — generate captions')
            }}
          >
            ✓ Plan complete — Generate Captions →
          </button>
        )}
      </div>

      {/* ── PLAN WORKSPACE ── */}
      {state.plan.length > 0 && (
        <div className="plan-workspace">

          {/* Grid */}
          <div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--mute)',
                fontFamily: 'var(--font-mono)',
                marginBottom: 8,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>Instagram grid · drag to reorder · alt+drag image to pan</span>
              <span>{state.plan.length} posts</span>
            </div>
            <div className="plan-grid">
              {state.plan.map((p, i) => {
                const img = p.imageIndex ? imgByIdx(p.imageIndex) : null
                const isEmpty = !img
                const igNum = state.plan.length - i
                const isInspected = inspectIdx === i
                const slides = p.slides?.length || 1

                return (
                  <div
                    key={i}
                    className={`plan-cell ${isEmpty ? 'empty' : ''} ${isInspected ? 'inspected' : ''} ${p.locked ? 'locked' : ''} ${dragOver === i ? 'drag-over' : ''}`}
                    style={{ aspectRatio: `${size.w}/${size.h}` }}
                    draggable={!isEmpty && !p.locked}
                    onDragStart={e => { e.dataTransfer.setData('plan-cell-idx', i); e.currentTarget.style.opacity = '.4' }}
                    onDragEnd={e => e.currentTarget.style.opacity = '1'}
                    onDragOver={e => { e.preventDefault(); setDragOver(i) }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={e => handleCellDrop(e, i)}
                    onClick={() => !isEmpty && setInspectIdx(i)}
                    onMouseDown={e => !isEmpty && startPan(e, i)}
                    title={isEmpty ? `Slot ${igNum} — drag image here` : `Post #${igNum} · click to inspect · alt+drag to pan`}
                  >
                    {isEmpty ? (
                      <div className="cell-empty-inner">
                        <div className="cell-num">#{igNum}</div>
                        <div className="cell-plus">+</div>
                        <div className="cell-hint">drag image</div>
                      </div>
                    ) : (
                      <>
                        <img
                          src={img.dataUrl}
                          alt=""
                          style={{
                            width: '100%', height: '100%',
                            objectFit: 'cover', display: 'block',
                            objectPosition: `${p.panX || 50}% ${p.panY || 50}%`,
                          }}
                        />
                        {p.locked && <span className="cell-lock-icon">🔒</span>}
                        <div className="cell-type-badge">
                          {p.type}{p.type === 'carousel' && slides > 1 ? ` ▤${slides}` : ''}
                        </div>
                        {!p.caption && <div className="cell-no-cap">no cap</div>}
                        <div className="cell-overlay">
                          <div className="cell-meta">#{igNum} · {p.theme || p.type}</div>
                          <div className="cell-actions">
                            <button className="cell-action-btn silver"
                              onClick={e => { e.stopPropagation(); setInspectIdx(i) }}>inspect</button>
                            <button className="cell-action-btn"
                              onClick={e => { e.stopPropagation(); toggleLock(i) }}>
                              {p.locked ? '🔓' : '🔒'}
                            </button>
                            <button className="cell-action-btn"
                              onClick={e => { e.stopPropagation(); clearSlot(i) }}>✕</button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Carousel Inspector */}
          <div className="carousel-inspector">
            {inspectedPost ? (
              <>
                <div className="inspector-header">
                  <div className="inspector-title">
                    Post #{state.plan.length - inspectIdx}
                  </div>
                  <div className="inspector-type-btns">
                    {['single', 'carousel', 'reel'].map(t => (
                      <button
                        key={t}
                        className={`type-btn ${inspectedPost.type === t ? 'active' : ''}`}
                        onClick={() => setPlanItem(inspectIdx, { type: t })}
                      >{t}</button>
                    ))}
                    <button
                      className={`type-btn ${inspectedPost.locked ? 'active' : ''}`}
                      onClick={() => toggleLock(inspectIdx)}
                      style={{ marginLeft: 4 }}
                    >{inspectedPost.locked ? '🔒' : '🔓'}</button>
                  </div>
                </div>

                {/* Slides */}
                {inspectedPost.slides?.length > 0 && (
                  <div className="inspector-slides" style={{ marginBottom: 12 }}>
                    {inspectedPost.slides.map((idx, si) => {
                      const sImg = imgByIdx(idx)
                      return (
                        <div key={si} className="slide-thumb">
                          {sImg && <img src={sImg.dataUrl} alt="" />}
                          <div className="slide-num">{si + 1}</div>
                          {inspectedPost.slides.length > 1 && (
                            <button className="slide-remove"
                              onClick={() => removeSlide(inspectIdx, si)}>✕</button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Unassigned */}
                {unassigned.length > 0 && (
                  <>
                    <div className="inspector-unassigned-label">
                      {unassigned.length} unassigned — click to add to carousel
                    </div>
                    <div className="unassigned-grid">
                      {unassigned.map(img => {
                        const imgIdx = state.images.indexOf(img) + 1
                        return (
                          <div
                            key={img.id}
                            className="unassigned-thumb"
                            onClick={() => appendSlide(inspectIdx, imgIdx)}
                            draggable
                            onDragStart={e => e.dataTransfer.setData('unassigned-img', imgIdx)}
                            title={`${img.name} · click to add`}
                          >
                            <img src={img.dataUrl} alt="" />
                            {img.orientation !== 'portrait' && (
                              <span className={`orient-badge ${img.orientation}`} style={{ position: 'absolute', top: 2, left: 2 }}>
                                {img.orientation === 'landscape' ? 'L' : 'S'}
                              </span>
                            )}
                            <div className="unassigned-add">+</div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}

                {unassigned.length === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>
                    All images assigned ✓
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: 8 }}>
                <div style={{ fontSize: 28, opacity: .2 }}>≡</div>
                <div style={{ fontSize: 11, color: 'var(--mute)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                  Click any post in the grid<br/>to inspect its slides
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
