import { useState, useCallback, useEffect } from 'react'
import { useStore, claudeVision, claudeCall, M_SONNET, M_HAIKU } from '../store.jsx'

const VOICE_OPTIONS = [
  { id: 'documentary', label: 'Documentary', desc: 'Story-driven, observational, intimate' },
  { id: 'editorial',   label: 'Editorial',   desc: 'Confident, directorial, magazine tone' },
  { id: 'luxury',      label: 'Luxury',      desc: 'Aspirational, understated, world-class' },
  { id: 'candid',      label: 'Candid',      desc: 'Personal, behind-the-scenes, warm' },
]

const CAPTION_SYSTEM = (handle, context, voice) => `You are writing Instagram captions for ${handle}, a luxury commercial photography studio.

Brand context: ${context || 'Luxury commercial photography — hospitality, F&B, architectural, lifestyle'}
Voice — ${voice}

Rules:
- NEVER use: "capturing moments", "telling stories", "through the lens", "timeless", "bespoke"
- NEVER start with "In", "At", "This is", "Today"
- 3-5 sentences maximum
- End with one question or observation inviting engagement
- Write from Kshetej Sareen Studios' perspective always
- Do NOT include hashtags — those are separate

Return ONLY two sections separated by ---
First: the caption
Second: 20 hashtags starting with # relevant to the image content, brand, and location`

function loadMemory() {
  try { return JSON.parse(localStorage.getItem('kss_caption_memory') || '[]') } catch { return [] }
}
function saveMemory(mem) {
  localStorage.setItem('kss_caption_memory', JSON.stringify(mem.slice(0, 50)))
}

export default function CaptionsTab({ showToast }) {
  const { state, setPlanItem } = useStore()
  const [voice, setVoice]           = useState('documentary')
  const [generating, setGenerating] = useState(null)
  const [progress, setProgress]     = useState('')
  const [editingIdx, setEditingIdx] = useState(null)
  const [memory, setMemory]         = useState(loadMemory)
  const [showMemory, setShowMemory] = useState(false)
  const [checking, setChecking]     = useState(false)
  const [gridFeedback, setGridFeedback] = useState('')

  const filledPosts = state.plan.filter(p => p.imageIndex)
  const imgByIdx = useCallback(idx => {
    if (!idx || idx < 1 || idx > state.images.length) return null
    return state.images[idx - 1] || null
  }, [state.images])

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
      ? `\n\nFor reference, here are some previously approved captions from this studio:\n${memory.slice(0,3).map(m => `"${m.caption}"`).join('\n')}\nMatch this voice and style.`
      : ''

    const system = CAPTION_SYSTEM(
      state.settings.handle || '@kshetejsareenstudios',
      state.globalContext,
      `${voiceObj.label}: ${voiceObj.desc}`
    ) + memoryRef

    const igNum = state.plan.length - planIdx
    const prompt = `Post #${igNum} of ${state.plan.length}.
Type: ${p.type}${p.slides?.length > 1 ? ` (${p.slides.length}-slide carousel)` : ''}
Theme: ${p.theme || 'not specified'}
Notes: ${p.notes || 'none'}

Look at the image. Note the mood, lighting, subject, composition. Write a caption that feels earned by what you see — specific, not generic.`

    try {
      const raw = await claudeVision(key, system, prompt, img.dataUrl, M_SONNET, 1000)
      const parts = raw.split('---')
      const caption = parts[0]?.trim() || raw.trim()
      const hashtags = parts[1]?.trim() || ''
      setPlanItem(planIdx, { caption, firstComment: hashtags, captionApproved: false })
      return true
    } catch (e) {
      showToast(`Error on post ${igNum}: ${e.message}`)
      return false
    }
  }, [state, voice, memory, imgByIdx, setPlanItem, showToast])

  // ── Generate all ──
  const generateAll = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    if (!filledPosts.length) { showToast('No posts with images'); return }
    setGenerating('all')
    let done = 0
    for (let i = 0; i < state.plan.length; i++) {
      if (!state.plan[i].imageIndex) continue
      setProgress(`${done + 1} of ${filledPosts.length}`)
      await generateCaption(i)
      done++
      await new Promise(r => setTimeout(r, 600))
    }
    setGenerating(null); setProgress('')
    showToast(`${done} captions generated ✓`)
  }, [state.plan, filledPosts.length, generateCaption, showToast])

  // ── Approve + save to memory ──
  const approveCaption = useCallback((planIdx) => {
    const p = state.plan[planIdx]
    if (!p?.caption) return
    setPlanItem(planIdx, { captionApproved: true })
    const newMem = [{ caption: p.caption, voice, theme: p.theme, ts: Date.now() }, ...memory].slice(0, 50)
    setMemory(newMem)
    saveMemory(newMem)
    showToast('Caption approved + saved to memory ✓')
  }, [state.plan, voice, memory, setPlanItem, showToast])

  // ── Grid aesthetics check ──
  const checkGridAesthetics = useCallback(async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    const filled = state.plan.filter(p => p.imageIndex)
    if (filled.length < 3) { showToast('Need at least 3 posts to check grid'); return }
    setChecking(true)
    try {
      const imageList = state.plan.map((p, i) => {
        if (!p.imageIndex) return `Post ${state.plan.length - i}: EMPTY`
        const img = imgByIdx(p.imageIndex)
        return `Post ${state.plan.length - i}: ${img?.orientation || 'unknown'} orientation, theme: ${p.theme || 'none'}, type: ${p.type}`
      }).join('\n')

      const system = `You are an Instagram grid aesthetics expert for a luxury photography studio. Analyse the planned grid layout and give concise, actionable feedback.`
      const prompt = `Analyse this Instagram grid plan for visual flow, colour balance, orientation variety, and carousel placement:

${imageList}

Context: ${state.globalContext || 'luxury photography'}

Check for:
1. Adjacent similar images (same orientation, subject, mood)
2. Colour/tone balance across the grid
3. Good carousel placement (not all in one row)
4. Visual rhythm and variety

Give 3-5 specific issues or confirmations. Be direct and actionable. Format as bullet points.`

      const result = await claudeCall(key, system, prompt, M_HAIKU, 600)
      setGridFeedback(result)
    } catch(e) { showToast('Check failed: ' + e.message) }
    finally { setChecking(false) }
  }, [state, imgByIdx, showToast])

  const copyCaption = (p) => {
    const text = [p.caption, p.firstComment].filter(Boolean).join('\n\n')
    navigator.clipboard.writeText(text).then(() => showToast('Copied ✓'))
  }

  const approvedCount = filledPosts.filter(p => p.captionApproved).length
  const captionedCount = filledPosts.filter(p => p.caption).length

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
    <div>
      {/* Controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="card-title">Caption Generator</div>
            <div className="card-sub">Vision-based · Kshetej Sareen Studios' voice</div>
            {/* Voice */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 12 }}>
              {VOICE_OPTIONS.map(v => (
                <button key={v.id} onClick={() => setVoice(v.id)}
                  style={{ padding: '7px 8px', textAlign: 'left', background: voice === v.id ? 'var(--silver-glow)' : 'var(--surface2)', border: `1px solid ${voice === v.id ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 'var(--r)', cursor: 'pointer', transition: 'all .15s' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: voice === v.id ? 'var(--silver)' : 'var(--text)', marginBottom: 2 }}>{v.label}</div>
                  <div style={{ fontSize: 8, color: 'var(--mute)', lineHeight: 1.3 }}>{v.desc}</div>
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={generateAll} disabled={!!generating} style={{ minWidth: 150 }}>
                {generating === 'all' ? <><span className="spin" /> {progress}</> : `✦ Generate All (${filledPosts.length})`}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={checkGridAesthetics} disabled={checking}>
                {checking ? <><span className="spin" /> Checking…</> : '⊞ Check Grid'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowMemory(m => !m)}>
                💾 Memory ({memory.length})
              </button>
              <div style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)', alignSelf: 'center' }}>
                {captionedCount}/{filledPosts.length} captioned
                {approvedCount > 0 && <span style={{ color: 'var(--green)', marginLeft: 8 }}>· {approvedCount} approved</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Grid feedback */}
        {gridFeedback && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: '1px solid var(--border)', position: 'relative' }}>
            <div style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', marginBottom: 6, letterSpacing: '.1em', textTransform: 'uppercase' }}>Grid Analysis</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{gridFeedback}</div>
            <button onClick={() => setGridFeedback('')}
              style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
        )}

        {/* Memory panel */}
        {showMemory && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: 'var(--silver)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', flex: 1 }}>Caption Memory — {memory.length} saved</div>
              {memory.length > 0 && (
                <button className="btn btn-ghost btn-xs" onClick={() => { setMemory([]); saveMemory([]); showToast('Memory cleared') }}>Clear all</button>
              )}
            </div>
            {memory.length === 0 ? (
              <div style={{ fontSize: 10, color: 'var(--mute)' }}>No approved captions yet — approve captions to build your voice library</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                {memory.map((m, i) => (
                  <div key={i} style={{ padding: '8px 10px', background: 'var(--surface)', borderRadius: 4, border: '1px solid var(--border)', fontSize: 11, color: 'var(--text2)', lineHeight: 1.5, position: 'relative' }}>
                    {m.caption}
                    <button onClick={() => { const nm = memory.filter((_,j)=>j!==i); setMemory(nm); saveMemory(nm) }}
                      style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 10 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Post cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state.plan.map((p, planIdx) => {
          if (!p.imageIndex) return null
          const img = imgByIdx(p.imageIndex)
          const igNum = state.plan.length - planIdx
          const isGenerating = generating === planIdx
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
                  <div style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)', flex: 1 }}>
                    {p.theme || p.type}
                  </div>
                  {p.captionApproved && (
                    <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'var(--font-mono)' }}>✓ approved</span>
                  )}
                  <button className="btn btn-ghost btn-xs"
                    onClick={() => { setGenerating(planIdx); generateCaption(planIdx).finally(() => setGenerating(null)) }}
                    disabled={!!generating}>
                    {isGenerating ? <span className="spin" /> : hasCap ? '↺' : '✦ Gen'}
                  </button>
                  {hasCap && !p.captionApproved && (
                    <button className="btn btn-ghost btn-xs" style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
                      onClick={() => approveCaption(planIdx)}>✓</button>
                  )}
                  {p.captionApproved && (
                    <button className="btn btn-ghost btn-xs" onClick={() => setPlanItem(planIdx, { captionApproved: false })}>undo</button>
                  )}
                  {hasCap && (
                    <button className="btn btn-ghost btn-xs" onClick={() => copyCaption(p)}>⎘</button>
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
                  <div onClick={() => setEditingIdx(`ht_${planIdx}`)}
                    style={{ fontSize: 9, color: 'var(--silver-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.5, cursor: 'text', padding: '5px 10px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: '1px solid var(--border)', minHeight: 28 }}>
                    {p.firstComment || '# first comment hashtags'}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
