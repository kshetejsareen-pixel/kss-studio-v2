import { useState } from 'react'
import { useStore, claudeCall, M_HAIKU } from '../store.jsx'

export default function ShootChecklist({ onClose, showToast }) {
  const { state } = useStore()
  const [generating, setGenerating] = useState(false)
  const [checklist, setChecklist]   = useState(null)
  const [checked, setChecked]       = useState({})

  const generate = async () => {
    const key = state.settings.anthropicKey
    if (!key) { showToast('Add API key in Settings'); return }
    const context = state.globalContext
    if (!context) { showToast('Add brand context in the Brief bar first'); return }
    setGenerating(true)
    try {
      const existingPlan = state.plan.filter(p => p.imageIndex).length
      const system = `You are a pre-production coordinator for a luxury photography studio. Generate concise, specific shot lists.`
      const prompt = `Generate a shoot checklist for this project:

Brand/Project: ${context}
Posts planned: ${existingPlan > 0 ? existingPlan + ' already planned' : 'none yet — planning from scratch'}
Format: ${state.postW}×${state.postH}

Generate a JSON object with these sections:
{
  "hero_shots": ["shot description",...],  // 4-6 essential cover images
  "carousel_sets": ["set description",...], // 3-4 multi-image sequences
  "detail_shots": ["shot",...],             // 4-6 detail/texture/product close-ups
  "atmosphere": ["shot",...],               // 3-4 ambient/mood shots
  "story_content": ["shot",...],            // 3-4 vertical/story-specific shots
  "pro_tips": ["tip",...],                  // 3-5 specific tips for this shoot
  "equipment_notes": "string"               // any specific gear notes
}

Be specific to this brand — not generic photography advice. Return ONLY valid JSON.`

      const raw = await claudeCall(key, system, prompt, M_HAIKU, 1500)
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('No JSON in response')
      const parsed = JSON.parse(match[0])
      setChecklist(parsed)
      setChecked({})
    } catch(e) { showToast('Error: ' + e.message); console.error(e) }
    finally { setGenerating(false) }
  }

  const toggleCheck = (section, i) => {
    const key = `${section}_${i}`
    setChecked(c => ({ ...c, [key]: !c[key] }))
  }

  const totalItems = checklist ? Object.entries(checklist)
    .filter(([k]) => Array.isArray(checklist[k]))
    .reduce((sum, [,arr]) => sum + arr.length, 0) : 0
  const checkedCount = Object.values(checked).filter(Boolean).length

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.88)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', backdropFilter: 'blur(8px)', overflowY: 'auto', padding: '40px 20px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 12, padding: 28, maxWidth: 600, width: '100%', boxShadow: 'var(--shadow-lg)' }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, marginBottom: 4 }}>Shot Checklist</div>
            <div style={{ fontSize: 12, color: 'var(--mute)' }}>
              AI-generated from your brief — {state.globalContext ? state.globalContext.split('|')[0].trim() : 'add a brief first'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: '50%', width: 32, height: 32, color: 'var(--mute)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 12 }}>✕</button>
        </div>

        {!checklist ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 11, color: 'var(--mute)', marginBottom: 20 }}>
              Claude will analyse your brief and generate a comprehensive shot list — hero shots, carousel sets, details, atmosphere, and story content.
            </div>
            <button className="btn btn-primary" onClick={generate} disabled={generating} style={{ minWidth: 180 }}>
              {generating ? <><span className="spin" /> Generating…</> : '✦ Generate Shot List'}
            </button>
          </div>
        ) : (
          <>
            {/* Progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8 }}>
              <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: 'var(--silver)', borderRadius: 2, width: `${totalItems ? (checkedCount/totalItems*100) : 0}%`, transition: 'width .3s' }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{checkedCount}/{totalItems}</div>
              <button className="btn btn-ghost btn-xs" onClick={generate} disabled={generating}>↺ Regen</button>
            </div>

            {/* Sections */}
            {[
              ['hero_shots',     '◈ Hero Shots'],
              ['carousel_sets',  '▤ Carousel Sets'],
              ['detail_shots',   '⊡ Detail Shots'],
              ['atmosphere',     '◌ Atmosphere'],
              ['story_content',  '↕ Story Content'],
            ].map(([key, label]) => checklist[key]?.length ? (
              <div key={key} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
                {checklist[key].map((item, i) => {
                  const isChecked = checked[`${key}_${i}`]
                  return (
                    <div key={i} onClick={() => toggleCheck(key, i)}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4, background: isChecked ? 'var(--green-dim)' : 'var(--surface2)', border: `1px solid ${isChecked ? 'var(--green)' : 'var(--border)'}`, transition: 'all .15s' }}>
                      <div style={{ width: 16, height: 16, border: `2px solid ${isChecked ? 'var(--green)' : 'var(--border2)'}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, background: isChecked ? 'var(--green)' : 'none' }}>
                        {isChecked && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </div>
                      <div style={{ fontSize: 12, color: isChecked ? 'var(--mute)' : 'var(--text)', lineHeight: 1.4, textDecoration: isChecked ? 'line-through' : 'none' }}>{item}</div>
                    </div>
                  )
                })}
              </div>
            ) : null)}

            {/* Pro tips */}
            {checklist.pro_tips?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>⚡ Pro Tips</div>
                {checklist.pro_tips.map((tip, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text2)', padding: '6px 10px', marginBottom: 4, borderLeft: '2px solid var(--amber)', paddingLeft: 12, lineHeight: 1.5 }}>{tip}</div>
                ))}
              </div>
            )}

            {/* Equipment */}
            {checklist.equipment_notes && (
              <div style={{ padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)', marginBottom: 4, letterSpacing: '.1em', textTransform: 'uppercase' }}>Equipment Notes</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{checklist.equipment_notes}</div>
              </div>
            )}

            {/* Export */}
            <button className="btn btn-ghost btn-full" style={{ marginTop: 16 }}
              onClick={() => {
                const text = Object.entries(checklist)
                  .map(([k, v]) => Array.isArray(v) ? `${k.toUpperCase()}\n${v.map(i=>`- ${i}`).join('\n')}` : `${k.toUpperCase()}\n${v}`)
                  .join('\n\n')
                const blob = new Blob([text], {type:'text/plain'})
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'KSS-Shot-List.txt'; a.click()
                showToast('Shot list exported ✓')
              }}>
              ↓ Export Shot List
            </button>
          </>
        )}
      </div>
    </div>
  )
}
