import { useState } from 'react'
import { useDriveImport } from '../hooks/useDriveImport.js'

const HISTORY_KEY = 'kss_drive_history'

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function saveToHistory(url) {
  const h = loadHistory().filter(u => u !== url)
  const updated = [url, ...h].slice(0, 10) // keep last 10
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
  return updated
}

export default function DriveModal({ apiKey, onImport, onClose, showToast }) {
  const {
    folders, folderInput, setFolderInput,
    addFolder, removeFolder, browseAll,
    loading, progress,
  } = useDriveImport({ apiKey, onImport, showToast })

  const [history, setHistory]     = useState(loadHistory)
  const [showHistory, setShowHistory] = useState(false)

  const handleAdd = () => {
    if (!folderInput.trim()) return
    const updated = saveToHistory(folderInput.trim())
    setHistory(updated)
    addFolder()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd()
    if (e.key === 'Escape') setShowHistory(false)
  }

  const selectFromHistory = (url) => {
    setFolderInput(url)
    setShowHistory(false)
  }

  const removeFromHistory = (url, e) => {
    e.stopPropagation()
    const updated = history.filter(u => u !== url)
    setHistory(updated)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated))
  }

  // Extract folder name from URL for display
  const getFolderName = (url) => {
    const match = url.match(/folders\/([^?/]+)/)
    return match ? match[1].slice(0, 20) + '…' : url.slice(0, 30) + '…'
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>

        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">Import from Google Drive</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Folder URL input + history */}
        <div className="field" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <div className="field-label" style={{ flex: 1 }}>Drive Folder URL</div>
            {history.length > 0 && (
              <button
                onClick={() => setShowHistory(s => !s)}
                style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: showHistory ? 'var(--silver)' : 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                🕐 History ({history.length}) {showHistory ? '▲' : '▼'}
              </button>
            )}
          </div>

          {/* History dropdown */}
          {showHistory && history.length > 0 && (
            <div style={{ marginBottom: 8, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
              {history.map((url, i) => (
                <div key={i}
                  onClick={() => selectFromHistory(url)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', borderBottom: i < history.length - 1 ? '1px solid var(--border)' : 'none', transition: 'background .1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: .5 }}>
                    <path d="M2.7 8.65l1.58 2.73c.33.57.8 1.02 1.35 1.35L10 8H0c0 .63.17 1.27.5 1.84z" fill="#0066da"/>
                    <path d="M8 4.33L5.27.5A2.8 2.8 0 003.93 0c-.63 0-1.27.17-1.84.5L.27 4.57c-.57.33-1.04.8-1.35 1.35L5.27 9.33z" fill="#00ac47"/>
                    <path d="M10 8H5.27l-2.34 3.73c.55.33 1.19.5 1.84.5h8.46c.65 0 1.27-.17 1.84-.5z" fill="#2684fc"/>
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</div>
                  </div>
                  <button
                    onClick={e => removeFromHistory(url, e)}
                    style={{ background: 'none', border: 'none', color: 'var(--mute)', cursor: 'pointer', fontSize: 11, padding: '0 2px', flexShrink: 0 }}>✕</button>
                </div>
              ))}
              <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)' }}>
                <button
                  onClick={() => { setHistory([]); localStorage.removeItem(HISTORY_KEY); setShowHistory(false) }}
                  style={{ fontSize: 9, color: 'var(--mute)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                  Clear history
                </button>
              </div>
            </div>
          )}

          <div className="row" style={{ gap: 8 }}>
            <input
              className="input flex1"
              placeholder="https://drive.google.com/drive/folders/…"
              value={folderInput}
              onChange={e => { setFolderInput(e.target.value); setShowHistory(false) }}
              onKeyDown={handleKeyDown}
              onFocus={() => history.length > 0 && !folderInput && setShowHistory(true)}
              disabled={loading}
            />
            <button className="btn btn-ghost btn-sm" onClick={handleAdd}
              disabled={loading || !folderInput.trim()} style={{ flexShrink: 0 }}>
              + Add
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 4 }}>
            Paste a public "Anyone with link" Drive folder URL · Press Enter or click Add
          </div>
        </div>

        {/* Folder list */}
        {folders.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="field-label" style={{ marginBottom: 8 }}>Queued Folders</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {folders.map(f => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 'var(--r)', border: '1px solid var(--border)' }}>
                  <span style={{ flexShrink: 0, fontSize: 12 }}>
                    {f.status === 'loading' ? <span className="spin" style={{ width: 10, height: 10 }} /> :
                     f.status === 'done'    ? '✓' :
                     f.status === 'error'   ? '✕' : '○'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.url}</div>
                    {f.status === 'done'  && <div style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>{f.count} images loaded</div>}
                    {f.status === 'error' && <div style={{ fontSize: 10, color: '#c06060', fontFamily: 'var(--font-mono)' }}>{f.error}</div>}
                  </div>
                  <button className="btn btn-ghost btn-xs" onClick={() => removeFolder(f.id)} disabled={loading} style={{ flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Progress */}
        {loading && progress && (
          <div style={{ padding: '10px 12px', background: 'var(--surface2)', borderRadius: 'var(--r)', fontSize: 11, color: 'var(--silver)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
            {progress}
          </div>
        )}

        {/* No API key warning */}
        {!apiKey && (
          <div style={{ padding: '10px 12px', background: 'var(--red-dim)', border: '1px solid rgba(138,58,58,.3)', borderRadius: 'var(--r)', fontSize: 11, color: '#c08080', marginBottom: 12 }}>
            ⚠ Add your Google API key in Settings before importing
          </div>
        )}

        {/* Actions */}
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn-primary" onClick={browseAll} disabled={loading || !folders.length || !apiKey}>
            {loading ? <><span className="spin" /> Loading…</> : `Browse All${folders.length > 1 ? ` (${folders.length} folders)` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
