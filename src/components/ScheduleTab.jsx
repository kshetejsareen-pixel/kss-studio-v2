import { useState, useCallback } from 'react'
import { useStore } from '../store.jsx'

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getNextSlot(existing) {
  // Best times: Mon/Wed/Fri at 9am, 12pm, 6pm IST
  const now = new Date()
  const slots = []
  for (let d = 0; d < 14; d++) {
    const day = new Date(now)
    day.setDate(now.getDate() + d)
    const dow = day.getDay()
    if ([1, 3, 5].includes(dow)) { // Mon Wed Fri
      for (const hour of [9, 12, 18]) {
        const slot = new Date(day)
        slot.setHours(hour, 0, 0, 0)
        if (slot > now && !existing.includes(slot.toISOString())) {
          slots.push(slot.toISOString())
        }
      }
    }
  }
  return slots[0] || new Date(Date.now() + 86400000).toISOString()
}

export default function ScheduleTab({ showToast }) {
  const { state, set, setPlanItem } = useStore()
  const [filter, setFilter] = useState('all') // all | scheduled | draft

  const imgByIdx = useCallback(idx => {
    if (!idx || idx < 1 || idx > state.images.length) return null
    return state.images[idx - 1] || null
  }, [state.images])

  // Pull all filled plan posts into queue
  const pushAllToQueue = () => {
    const filled = state.plan.filter(p => p.imageIndex)
    if (!filled.length) { showToast('No filled posts in plan'); return }
    const existing = state.queue.map(q => q.scheduledAt).filter(Boolean)
    const newQueue = [...state.queue]

    state.plan.forEach((p, planIdx) => {
      if (!p.imageIndex) return
      const exists = newQueue.find(q => q.planIdx === planIdx)
      if (!exists) {
        const slot = getNextSlot(existing)
        existing.push(slot)
        newQueue.push({
          id: `q_${Date.now()}_${planIdx}`,
          planIdx,
          scheduledAt: slot,
          status: 'draft',
        })
      }
    })
    set('queue', newQueue)
    showToast(`${newQueue.length - state.queue.length} posts added to queue ✓`)
  }

  const removeFromQueue = (id) => {
    set('queue', state.queue.filter(q => q.id !== id))
  }

  const updateQueueItem = (id, updates) => {
    set('queue', state.queue.map(q => q.id === id ? { ...q, ...updates } : q))
  }

  const sortedQueue = [...state.queue].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
  const filtered = filter === 'all' ? sortedQueue : sortedQueue.filter(q => q.status === filter)

  return (
    <div>
      {/* Header */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Schedule</div>
        <div className="card-sub">Queue your posts and assign publishing dates</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={pushAllToQueue}>
            + Queue All from Plan ({state.plan.filter(p => p.imageIndex).length} posts)
          </button>
          <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
            {['all', 'scheduled', 'draft'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: '4px 10px', fontSize: 10, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', background: filter === f ? 'var(--silver-glow)' : 'none', border: `1px solid ${filter === f ? 'var(--silver-border)' : 'var(--border)'}`, borderRadius: 2, color: filter === f ? 'var(--silver)' : 'var(--mute)', cursor: 'pointer' }}>
                {f} {f === 'all' ? `(${state.queue.length})` : `(${state.queue.filter(q => q.status === f).length})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Queue */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 28, opacity: .15, marginBottom: 12 }}>📅</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, marginBottom: 8 }}>No posts queued</div>
          <div style={{ fontSize: 12, color: 'var(--mute)' }}>Click "Queue All from Plan" to add your posts</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(q => {
            const p = state.plan[q.planIdx]
            if (!p) return null
            const img = imgByIdx(p.imageIndex)
            const igNum = p ? state.plan.length - q.planIdx : '?'

            return (
              <div key={q.id} className="card" style={{ padding: 14, display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 14, alignItems: 'center' }}>
                {/* Thumb */}
                <div style={{ width: 48, height: 48, borderRadius: 'var(--r)', overflow: 'hidden', background: 'var(--surface2)', flexShrink: 0 }}>
                  {img && <img src={img.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>

                {/* Info */}
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>#{igNum}</span>
                    <span style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>{p.type}</span>
                    {p.slides?.length > 1 && <span style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>▤{p.slides.length}</span>}
                    <span style={{ padding: '1px 6px', fontSize: 9, borderRadius: 10, fontFamily: 'var(--font-mono)', background: q.status === 'scheduled' ? 'var(--green-dim)' : 'var(--surface3)', color: q.status === 'scheduled' ? 'var(--green)' : 'var(--mute)', border: `1px solid ${q.status === 'scheduled' ? 'var(--green)' : 'var(--border)'}` }}>
                      {q.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.caption || <span style={{ color: 'var(--mute2)' }}>No caption yet</span>}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      type="datetime-local"
                      value={q.scheduledAt ? q.scheduledAt.slice(0, 16) : ''}
                      onChange={e => updateQueueItem(q.id, { scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : '', status: e.target.value ? 'scheduled' : 'draft' })}
                      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', color: 'var(--text)', fontSize: 11, padding: '3px 8px', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
                    />
                    {q.scheduledAt && (
                      <span style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>
                        {formatDate(q.scheduledAt)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => removeFromQueue(q.id)}>✕</button>
                  {q.status === 'scheduled' && state.settings.metaToken && (
                    <button className="btn btn-ghost btn-xs" style={{ color: 'var(--green)', borderColor: 'var(--green)', fontSize: 8 }}
                      onClick={() => { showToast('Publishing via Meta API — coming soon'); }}>
                      ↑ Publish
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Stats */}
      {state.queue.length > 0 && (
        <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', display: 'flex', gap: 24 }}>
          {[
            ['Total', state.queue.length],
            ['Scheduled', state.queue.filter(q => q.status === 'scheduled').length],
            ['Draft', state.queue.filter(q => q.status === 'draft').length],
            ['Captioned', state.plan.filter(p => p.caption).length],
          ].map(([label, val]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500, color: 'var(--text)' }}>{val}</div>
              <div style={{ fontSize: 9, color: 'var(--mute)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
