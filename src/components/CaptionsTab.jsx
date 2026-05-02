import { useState, useCallback, useRef } from 'react'
import { useStore, claudeVision, claudeCall, M_SONNET, M_HAIKU } from '../store.jsx'

const VOICE_OPTIONS = [
  { id: 'documentary', label: 'Documentary', desc: 'Story-driven, observational, intimate' },
  { id: 'editorial',   label: 'Editorial',   desc: 'Confident, directorial, magazine tone' },
  { id: 'luxury',      label: 'Luxury',      desc: 'Aspirational, understated, world-class' },
  { id: 'candid',      label: 'Candid',      desc: 'Personal, behind-the-scenes, warm' },
]

// Hashtag science: max 5, mix of niche/mid/broad
const HASHTAG_SYSTEM = (context) => `You are an Instagram hashtag strategist for a luxury photography studio.
Context: ${context || 'Luxury commercial photography'}

Hashtag science — select EXACTLY 5 hashtags using this mix:
- 1-2 NICHE tags (under 100k posts) — very specific to the exact subject/location/moment
- 2 MID-TIER tags (100k–500k posts) — relevant to the category
- 1 BROAD tag (500k+ posts) — one well-known industry tag

Rules:
- Never use generic tags like #photography #photo #instagood #love
- Tags must be directly relevant to what's in the image
- Consider the brand, location, and visual style
- Return ONLY 5 hashtags separated by spaces, nothing else`

const CAPTION_SYSTEM = (handle, context, voice, notes) => `You are writing Instagram captions for ${handle}, a luxury commercial photography studio.

Brand context: ${context || 'Luxury commercial photography — hospitality, F&B, architectural, lifestyle'}
${notes ? `Photographer's notes: ${notes}` : ''}
Voice — ${voice}

Rules:
- NEVER use: "capturing moments", "telling stories", "through the lens", "timeless", "bespoke"
- NEVER start with "In", "At", "This is", "Today"
- 3-5 sentences maximum
- End with one question or observation inviting engagement
- Write from Kshetej Sareen Studios' perspective always
- Do NOT include hashtags

Return ONLY the caption text, nothing else.`

const REFINE_SYSTEM = (handle, context, voice, notes) => `You are refining an Instagram caption for ${handle}, a luxury commercial photography studio.

Brand context: ${context || 'Luxury commercial photography'}
${notes ? `Photographer's notes: ${notes}` : ''}
Voice — ${voice}

The user has written or edited a caption. Improve it while:
- Keeping their core idea and intention intact
- Fixing any clichés or weak phrasing
- Sharpening the language to feel more editorial and considered
- Maintaining 3-5 sentences
- Ending with an engaging question or observation

Return ONLY the refined caption, nothing else.`

// Grid analysis that returns structured JSON with flagged pairs
const GRID_SYSTEM = `You are an Instagram grid aesthetics expert for a luxury photography studio.
Analyse the grid and return a JSON array of issues. Each issue has:
{
  "type": "similarity" | "imbalance" | "placement",
  "severity": "high" | "medium",
  "posts": [postNum1, postNum2],  // the two post numbers involved (higher number = more recent)
  "issue": "one sentence describing the problem",
  "suggestion": "one sentence on what to change",
  "swapAction": { "from": postNum1, "to": postNum2 }  // which posts to swap to fix it
}
Return ONLY valid JSON array, no other text.`

function loadMemory() {
  try { return JSON.parse(localStorage.getItem('kss_caption_memory') || '[]') } catch { return [] }
}
function saveMemory(mem) {
  localStorage.setItem('kss_caption_memory', JSON.stringify(mem.slice(0, 50)))
}

// Tooltip component
function Tip({ text, children }) {
  const [show, setShow] = useState(false)
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 6, background: 'var(--surface3)', border: '1px solid var(--border2)',
          color: 'var(--text)', fontSize: 10, padding: '5px 10px', borderRadius: 4,
          whiteSpace: 'nowrap', zIndex: 100, fontFamily: 'var(--font-mono)',
          boxShadow: '0 4px 12px rgba(0,0,0,.4)', pointerEvents: 'none',
        }}>{text}</span>
      )}
    </span>
  )
}

export default function CaptionsTab({ showToast }) {
  const { state, setPlanItem, set } = useStore()
  const [voice, setVoice]             = useState('documentary')
  const [generating, setGenerating]   = useState(null)
  const [refining, setRefining]       = useState(null)
  const [progress, setProgress]       = useState('')
  const [editingIdx, setEditingIdx]   = useState(null)
  const [memory, setMemory]           = useState(loadMemory)
  const [showMemory, setShowMemory]   = useState(false)
  const [checking, setChecking]       = useState(false)
  const [gridIssues, setGridIssues]   = useState([])  // structured issues
  const [planHistory, setPlanHistory] = useState(null) // for undo
  const [notes, setNotes]             = useState(state.captionNotes || '')
  const [savingAll, setSavingAll]     = useState(false)

  const filledPosts = state.plan.filter(p => p.imageIndex)
  const imgByIdx = useCallback(idx => {
    if (!idx || idx < 1 || idx > state.images.length) return null
    return state.images[idx - 1] || null
  }, [state.images])

  // Save notes to store when changed
  const handleNotesChange = (val) => {
    setNotes(val)
    set('captionNotes', val)
  }

  // ── Generate hashtags separately ──
  const generateHashtags = useCallback(async (key, img, context) => {
    try {
      const raw = await claudeVision(key, HASHTAG_SYSTEM(context), 'Generate 5 hashtags for this image.', img.dataUrl, M_HAIKU, 100)
      // Clean and limit to 5
      const tags = raw.trim().split(/\s+/).filter(t => t.startsWith('#')).slice(0, 5)
      return tags.join(' ')
    } catch { return '' }
  }, [])

  // ── Generate single caption ──
  const generateCaption = useCallback(async (planIdx) => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return false }
    const p = state.plan[planIdx]
    if (!p?.imageIndex) return false
    const img = imgByIdx(p.imageIndex)
    if (!img) return false

    const voiceObj = VOICE_OPTIONS.find(v => v.id === voice)
    const memoryRef = memory.length > 0
      ? `\n\nFor reference, previously approved captions:\n${memory.slice(0,3).map(m => `"${m.caption}"`).join('\n')}\nMatch this voice.`
      : ''
    const system = CAPTION_SYSTEM(
      state.settings.handle || '@kshetej.atwork',
      state.globalContext, `${voiceObj.label}: ${voiceObj.desc}`, notes
    ) + memoryRef

    const igNum = state.plan.length - planIdx
    const prompt = `Post #${igNum}. Type: ${p.type}. Theme: ${p.theme || 'none'}.
Look at the image carefully — mood, lighting, subject, composition. Write a caption specific to what you see.`

    try {
      const [caption, hashtags] = await Promise.all([
        claudeVision(key, system, prompt, img.dataUrl, M_SONNET, 500),
        generateHashtags(key, img, state.globalContext)
      ])
      setPlanItem(planIdx, { caption: caption.trim(), firstComment: hashtags, captionApproved: false })
      return true
    } catch (e) { showToast(`Error: ${e.message}`); return false }
  }, [state, voice, memory, notes, imgByIdx, setPlanItem, generateHashtags, showToast])

  // ── Refine caption ──
  const refineCaption = useCallback(async (planIdx) => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    const p = state.plan[planIdx]
    if (!p?.caption) { showToast('Write or generate a caption first'); return }
    setRefining(planIdx)
    const voiceObj = VOICE_OPTIONS.find(v => v.id === voice)
    const system = REFINE_SYSTEM(
      state.settings.handle || '@kshetej.atwork',
      state.globalContext, `${voiceObj.label}: ${voiceObj.desc}`, notes
    )
    try {
      const refined = await claudeCall(key, system, `Refine this caption:\n\n"${p.caption}"`, M_SONNET, 500)
      setPlanItem(planIdx, { caption: refined.trim(), captionApproved: false })
      showToast('Caption refined ✓')
    } catch(e) { showToast('Refine failed: ' + e.message) }
    finally { setRefining(null) }
  }, [state, voice, notes, setPlanItem, showToast])

  // ── Generate all ──
  const generateAll = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    setGenerating('all'); let done = 0
    for (let i = 0; i < state.plan.length; i++) {
      if (!state.plan[i].imageIndex) continue
      setProgress(`${done + 1} of ${filledPosts.length}`)
      await generateCaption(i); done++
      await new Promise(r => setTimeout(r, 500))
    }
    setGenerating(null); setProgress('')
    showToast(`${done} captions generated ✓`)
  }, [state.plan, filledPosts.length, generateCaption, showToast])

  // ── Approve + auto-save ──
  const approveCaption = useCallback((planIdx) => {
    const p = state.plan[planIdx]
    if (!p?.caption) return
    setPlanItem(planIdx, { captionApproved: true })
    const newMem = [{ caption: p.caption, voice, theme: p.theme, ts: Date.now() }, ...memory].slice(0, 50)
    setMemory(newMem); saveMemory(newMem)
    // Auto-save entire session
    const session = { plan: state.plan, images: [], globalContext: state.globalContext, savedAt: new Date().toISOString() }
    localStorage.setItem('kss_session_autosave', JSON.stringify(session))
    showToast('Approved + auto-saved ✓')
  }, [state, voice, memory, setPlanItem, showToast])

  // ── Grid checker — structured with visual ──
  const checkGridAesthetics = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    if (filledPosts.length < 3) { showToast('Need at least 3 posts'); return }
    setChecking(true); setGridIssues([])
    try {
      const imageList = state.plan.map((p, i) => {
        if (!p.imageIndex) return `Post ${state.plan.length - i}: EMPTY`
        const img = imgByIdx(p.imageIndex)
        return `Post ${state.plan.length - i}: ${img?.orientation || 'unknown'} orientation, theme: ${p.theme || 'none'}, type: ${p.type}`
      }).join('\n')

      const prompt = `Grid plan:\n${imageList}\n\nContext: ${state.globalContext || 'luxury photography'}\n\nFind 2-4 specific issues. Focus on adjacent similarity, orientation imbalance, carousel clustering.`
      const raw = await claudeCall(key, GRID_SYSTEM, prompt, M_HAIKU, 800)
      const match = raw.match(/\[[\s\S]*\]/)
      if (match) {
        const issues = JSON.parse(match[0])
        setGridIssues(issues)
      } else {
        showToast('No issues found — grid looks good ✓')
      }
    } catch(e) { showToast('Check failed: ' + e.message) }
    finally { setChecking(false) }
  }, [state, filledPosts.length, imgByIdx, showToast])

  // ── Apply AI swap suggestion ──
  const applySwap = useCallback((issue) => {
    // Save history for undo
    setPlanHistory([...state.plan])
    const newPlan = [...state.plan]
    // Convert post numbers to indices (post #N = plan[length - N])
    const fromIdx = state.plan.length - issue.swapAction.from
    const toIdx   = state.plan.length - issue.swapAction.to
    if (fromIdx >= 0 && toIdx >= 0 && fromIdx < newPlan.length && toIdx < newPlan.length) {
      ;[newPlan[fromIdx], newPlan[toIdx]] = [newPlan[toIdx], newPlan[fromIdx]]
      set('plan', newPlan)
      setGridIssues(prev => prev.filter(i => i !== issue))
      showToast(`Posts swapped ✓ — undo available`)
    }
  }, [state.plan, set, showToast])

  // ── Undo swap ──
  const undoSwap = useCallback(() => {
    if (!planHistory) return
    set('plan', planHistory)
    setPlanHistory(null)
    showToast('Swap undone ✓')
  }, [planHistory, set, showToast])

  // ── Save all ──
  const saveAll = useCallback(() => {
    setSavingAll(true)
    try {
      const session = {
        version: '1.0',
        savedAt: new Date().toISOString(),
        globalContext: state.globalContext,
        captionNotes: notes,
        plan: state.plan,
        queue: state.queue || [],
        settings: { handle: state.settings?.handle },
      }
      const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `KSS-Session-${new Date().toISOString().slice(0,10)}.json`
      a.click()
      localStorage.setItem('kss_session_autosave', JSON.stringify(session))
      showToast('Session saved ✓')
    } catch(e) { showToast('Save failed: ' + e.message) }
    finally { setSavingAll(false) }
  }, [state, notes, showToast])

  const copyCaption = (p) => {
    const text = [p.caption, p.firstComment].filter(Boolean).join('\n\n')
    navigator.clipboard.writeText(text).then(() => showToast('Copied ✓'))
  }

  const approvedCount   = filledPosts.filter(p => p.captionApproved).length
  const captionedCount  = filledPosts.filter(p => p.caption).length

  // Post number → plan index
  const postNumToPlanIdx = (num) => state.plan.length - num

  if (!state.plan.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ fontSize: 28, opacity: .2, marginBottom: 12 }}>✦</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 8 }}>No plan yet</div>
        <div style={{ fontSize: 12, color: 'var(--mute)' }}>Build your content plan first, then generate captions here.</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>

      {/* ── Controls ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Caption Generator</div>
        <div className="card-sub">Vision-based · Kshetej Sareen Studios' voice</div>

        {/* Voice selector */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 12 }}>
          {VOICE_OPTIONS.map(v => (
            <Tip key={v.id} text={v.desc}>
              <button onClick={() => setVoice(v.id)} style={{ width: '100%', padding: '7px 8px', textAlign: 'left', background: voice === v.id ? 'var(--silver-glow)' : 'var(--surface2)', border: `1px solid ${voice === v.id ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 'var(--r)', cursor: 'pointer', transition: 'all .15s' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: voice === v.id ? 'var(--silver)' : 'var(--text)', marginBottom: 2 }}>{v.label}</div>
                <div style={{ fontSize: 8, color: 'var(--mute)', lineHeight: 1.3 }}>{v.desc}</div>
              </button>
            </Tip>
          ))}
        </div>

        {/* Photographer notes */}
        <div style={{ marginBottom: 12 }}>
          <div className="field-label" style={{ marginBottom: 5 }}>Your notes <span style={{ color: 'var(--mute)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— added to every caption + research</span></div>
          <textarea className="textarea" rows={2} value={notes} onChange={e => handleNotesChange(e.target.value)}
            placeholder="e.g. This was shot on a rainy evening, the client wanted something moody and intimate…"
            style={{ fontSize: 11, resize: 'none' }} />
        </div>

        {/* Action row */}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Tip text="Generate captions for all posts using Claude Vision">
            <button className="btn btn-primary" onClick={generateAll} disabled={!!generating} style={{ minWidth: 150 }}>
              {generating === 'all' ? <><span className="spin" />{progress}</> : `✦ Generate All (${filledPosts.length})`}
            </button>
          </Tip>
          <Tip text="Analyse grid for visual flow, adjacent similarity, carousel placement">
            <button className="btn btn-ghost btn-sm" onClick={checkGridAesthetics} disabled={checking}>
              {checking ? <><span className="spin" />Checking…</> : '⊞ Check Grid'}
            </button>
          </Tip>
          <Tip text="View approved captions saved to voice memory">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowMemory(m => !m)}>
              💾 Memory ({memory.length})
            </button>
          </Tip>
          <Tip text="Save entire session — plan, captions, schedule — as JSON">
            <button className="btn btn-ghost btn-sm" onClick={saveAll} disabled={savingAll}>
              {savingAll ? <><span className="spin" />Saving…</> : '↓ Save Session'}
            </button>
          </Tip>
          {planHistory && (
            <button className="btn btn-ghost btn-sm" onClick={undoSwap} style={{ color: 'var(--amber)', borderColor: 'var(--amber)' }}>
              ↩ Undo Swap
            </button>
          )}
          <div style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)', alignSelf: 'center', marginLeft: 'auto' }}>
            {captionedCount}/{filledPosts.length} captioned
            {approvedCount > 0 && <span style={{ color: 'var(--green)', marginLeft: 8 }}>· {approvedCount} approved</span>}
          </div>
        </div>

        {/* Memory panel */}
        {showMemory && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', flex: 1 }}>Voice Memory — {memory.length} saved</div>
              {memory.length > 0 && <button className="btn btn-ghost btn-xs" onClick={() => { setMemory([]); saveMemory([]) }}>Clear</button>}
            </div>
            {memory.length === 0
              ? <div style={{ fontSize: 10, color: 'var(--mute)' }}>No approved captions yet</div>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                  {memory.map((m, i) => (
                    <div key={i} style={{ padding: '7px 10px', background: 'var(--surface)', borderRadius: 4, border: '1px solid var(--border)', fontSize: 11, color: 'var(--text2)', lineHeight: 1.5, position: 'relative' }}>
                      {m.caption}
                      <button onClick={() => { const nm = memory.filter((_,j)=>j!==i); setMemory(nm); saveMemory(nm) }}
                        style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 10 }}>✕</button>
                    </div>
                  ))}
                </div>
            }
          </div>
        )}
      </div>

      {/* ── Grid Issues — visual side by side ── */}
      {gridIssues.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ flex: 1 }}>Grid Analysis — {gridIssues.length} issue{gridIssues.length !== 1 ? 's' : ''}</div>
            <button onClick={() => setGridIssues([])} style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {gridIssues.map((issue, i) => {
              const p1 = state.plan[postNumToPlanIdx(issue.posts[0])]
              const p2 = state.plan[postNumToPlanIdx(issue.posts[1])]
              const img1 = p1 ? imgByIdx(p1.imageIndex) : null
              const img2 = p2 ? imgByIdx(p2.imageIndex) : null
              return (
                <div key={i} style={{ padding: '14px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: `1px solid ${issue.severity === 'high' ? 'rgba(200,146,74,.3)' : 'var(--border)'}` }}>
                  {/* Severity badge + issue */}
                  <div className="row" style={{ marginBottom: 10, gap: 8 }}>
                    <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 10, fontFamily: 'var(--font-mono)', background: issue.severity === 'high' ? 'rgba(200,146,74,.15)' : 'var(--surface3)', color: issue.severity === 'high' ? 'var(--amber)' : 'var(--mute)', border: `1px solid ${issue.severity === 'high' ? 'rgba(200,146,74,.3)' : 'var(--border)'}` }}>
                      {issue.severity}
                    </span>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{issue.type}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 6, lineHeight: 1.5 }}>{issue.issue}</div>
                  <div style={{ fontSize: 11, color: 'var(--mute)', marginBottom: 12, lineHeight: 1.5 }}>💡 {issue.suggestion}</div>

                  {/* Side by side thumbnails */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: '100%', aspectRatio: '4/5', borderRadius: 'var(--r)', overflow: 'hidden', border: '2px solid rgba(200,146,74,.4)', background: 'var(--surface)' }}>
                        {img1 ? <img src={img1.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--mute)', fontSize: 10 }}>empty</div>}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>Post #{issue.posts[0]}</div>
                    </div>
                    <div style={{ fontSize: 16, color: 'var(--mute)', textAlign: 'center' }}>⇄</div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: '100%', aspectRatio: '4/5', borderRadius: 'var(--r)', overflow: 'hidden', border: '2px solid rgba(200,146,74,.4)', background: 'var(--surface)' }}>
                        {img2 ? <img src={img2.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--mute)', fontSize: 10 }}>empty</div>}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>Post #{issue.posts[1]}</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="row" style={{ gap: 8 }}>
                    <Tip text={`Swap Post #${issue.posts[0]} and Post #${issue.posts[1]} in the grid`}>
                      <button className="btn btn-ghost btn-sm" onClick={() => applySwap(issue)} style={{ color: 'var(--silver)', borderColor: 'var(--silver-border)' }}>
                        ✦ Apply Suggestion
                      </button>
                    </Tip>
                    <button className="btn btn-ghost btn-sm" onClick={() => setGridIssues(prev => prev.filter((_, j) => j !== i))}>
                      Dismiss
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Post cards ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state.plan.map((p, planIdx) => {
          if (!p.imageIndex) return null
          const img = imgByIdx(p.imageIndex)
          const igNum = state.plan.length - planIdx
          const isGenerating = generating === planIdx
          const isRefining   = refining === planIdx
          const hasCap = !!p.caption

          return (
            <div key={planIdx} className="card" style={{ padding: 16, display: 'grid', gridTemplateColumns: '64px 1fr', gap: 16, opacity: p.captionApproved ? .85 : 1 }}>
              {/* Thumb */}
              <div>
                <div style={{ borderRadius: 'var(--r)', overflow: 'hidden', aspectRatio: '4/5', background: 'var(--surface2)', marginBottom: 4 }}>
                  {img && <img src={img.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <div style={{ fontSize: 8, color: 'var(--silver)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>#{igNum}</div>
                {p.type === 'carousel' && p.slides?.length > 1 && (
                  <div style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>▤{p.slides.length}</div>
                )}
              </div>

              {/* Content */}
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ marginBottom: 8, gap: 5, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)', flex: 1 }}>{p.theme || p.type}</div>
                  {p.captionApproved && (
                    <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'var(--font-mono)' }}>✓ approved</span>
                  )}
                  <Tip text={hasCap ? 'Regenerate caption' : 'Generate caption with Claude Vision'}>
                    <button className="btn btn-ghost btn-xs"
                      onClick={() => { setGenerating(planIdx); generateCaption(planIdx).finally(() => setGenerating(null)) }}
                      disabled={!!generating || !!refining}>
                      {isGenerating ? <span className="spin" /> : hasCap ? '↺' : '✦ Gen'}
                    </button>
                  </Tip>
                  {hasCap && (
                    <Tip text="Refine your caption — improves wording while keeping your intent">
                      <button className="btn btn-ghost btn-xs"
                        onClick={() => refineCaption(planIdx)}
                        disabled={!!generating || !!refining}>
                        {isRefining ? <span className="spin" /> : '✎ Refine'}
                      </button>
                    </Tip>
                  )}
                  {hasCap && !p.captionApproved && (
                    <Tip text="Approve and auto-save to memory + session">
                      <button className="btn btn-ghost btn-xs" style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
                        onClick={() => approveCaption(planIdx)}>✓</button>
                    </Tip>
                  )}
                  {p.captionApproved && (
                    <button className="btn btn-ghost btn-xs" onClick={() => setPlanItem(planIdx, { captionApproved: false })}>undo</button>
                  )}
                  {hasCap && (
                    <Tip text="Copy caption + hashtags to clipboard">
                      <button className="btn btn-ghost btn-xs" onClick={() => copyCaption(p)}>⎘</button>
                    </Tip>
                  )}
                </div>

                {/* Caption */}
                {editingIdx === planIdx ? (
                  <textarea className="textarea" value={p.caption || ''} autoFocus rows={4}
                    onChange={e => setPlanItem(planIdx, { caption: e.target.value })}
                    onBlur={() => setEditingIdx(null)}
                    style={{ fontSize: 12, marginBottom: 8 }} />
                ) : (
                  <div onClick={() => setEditingIdx(planIdx)}
                    style={{ fontSize: 12, color: hasCap ? 'var(--text)' : 'var(--mute2)', lineHeight: 1.6, marginBottom: 8, cursor: 'text', minHeight: 56, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: '1px solid var(--border)', whiteSpace: 'pre-wrap' }}>
                    {p.caption || 'Click Generate or type here →'}
                  </div>
                )}

                {/* Hashtags */}
                {editingIdx === `ht_${planIdx}` ? (
                  <textarea className="textarea" value={p.firstComment || ''} autoFocus rows={2}
                    onChange={e => setPlanItem(planIdx, { firstComment: e.target.value })}
                    onBlur={() => setEditingIdx(null)}
                    style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }} />
                ) : (
                  <Tip text="First comment hashtags — click to edit. Max 5, science-based selection.">
                    <div onClick={() => setEditingIdx(`ht_${planIdx}`)}
                      style={{ fontSize: 9, color: 'var(--silver-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.5, cursor: 'text', padding: '5px 10px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: '1px solid var(--border)', minHeight: 28, width: '100%' }}>
                      {p.firstComment || '# first comment hashtags (max 5)'}
                    </div>
                  </Tip>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
