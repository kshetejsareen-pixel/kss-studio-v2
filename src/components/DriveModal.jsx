import { useDriveImport } from '../hooks/useDriveImport.js'

export default function DriveModal({ apiKey, onImport, onClose, showToast }) {
  const {
    folders, folderInput, setFolderInput,
    addFolder, removeFolder, browseAll,
    loading, progress,
  } = useDriveImport({ apiKey, onImport, showToast })

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') addFolder()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }}>

        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">Import from Google Drive</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Folder URL input */}
        <div className="field" style={{ marginBottom: 12 }}>
          <div className="field-label">Drive Folder URL</div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input flex1"
              placeholder="https://drive.google.com/drive/folders/…"
              value={folderInput}
              onChange={e => setFolderInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={addFolder}
              disabled={loading || !folderInput.trim()}
              style={{ flexShrink: 0 }}
            >
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
            <div className="field-label" style={{ marginBottom: 8 }}>Folders</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {folders.map(f => (
                <div
                  key={f.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    background: 'var(--surface2)',
                    borderRadius: 'var(--r)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {/* Status icon */}
                  <span style={{ flexShrink: 0, fontSize: 12 }}>
                    {f.status === 'loading' ? <span className="spin" style={{ width: 10, height: 10 }} /> :
                     f.status === 'done' ? '✓' :
                     f.status === 'error' ? '✕' : '○'}
                  </span>

                  {/* Folder info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.url}
                    </div>
                    {f.status === 'done' && (
                      <div style={{ fontSize: 10, color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>
                        {f.count} images loaded
                      </div>
                    )}
                    {f.status === 'error' && (
                      <div style={{ fontSize: 10, color: '#c06060', fontFamily: 'var(--font-mono)' }}>
                        {f.error}
                      </div>
                    )}
                  </div>

                  {/* Remove */}
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => removeFolder(f.id)}
                    disabled={loading}
                    style={{ flexShrink: 0 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Progress */}
        {loading && progress && (
          <div style={{
            padding: '10px 12px',
            background: 'var(--surface2)',
            borderRadius: 'var(--r)',
            fontSize: 11,
            color: 'var(--silver)',
            fontFamily: 'var(--font-mono)',
            marginBottom: 12,
          }}>
            {progress}
          </div>
        )}

        {/* No API key warning */}
        {!apiKey && (
          <div style={{
            padding: '10px 12px',
            background: 'var(--red-dim)',
            border: '1px solid rgba(138,58,58,.3)',
            borderRadius: 'var(--r)',
            fontSize: 11,
            color: '#c08080',
            marginBottom: 12,
          }}>
            ⚠ Add your Google API key in Settings before importing
          </div>
        )}

        {/* Actions */}
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={browseAll}
            disabled={loading || !folders.length || !apiKey}
          >
            {loading
              ? <><span className="spin" /> Loading…</>
              : `Browse All${folders.length > 1 ? ` (${folders.length} folders)` : ''}`
            }
          </button>
        </div>
      </div>
    </div>
  )
}
