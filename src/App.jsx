import { useState, useCallback, useRef } from 'react'
import { StoreProvider, useStore, claudeResearch, readFileAsDataUrl, getImageDimensions, getImageOrientation } from './store.jsx'
import { useToast } from './hooks/useToast.js'
import DriveModal from './components/DriveModal.jsx'
import PlanTab from './components/PlanTab.jsx'
import StudioTab from './components/StudioTab.jsx'
import CaptionsTab from './components/CaptionsTab.jsx'
import ScheduleTab from './components/ScheduleTab.jsx'
import SettingsTab from './components/SettingsTab.jsx'

const TABS = [
  { id: 'plan',     label: 'Plan' },
  { id: 'studio',   label: 'Studio' },
  { id: 'captions', label: 'Captions' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'settings', label: 'Settings' },
]

function AppInner() {
  const { state, set, setSettings } = useStore()
  const [activeTab, setActiveTab] = useState('plan')
  const [contextDraft, setContextDraft] = useState(state.globalContext)
  const [synced, setSynced] = useState(true)
  const [researching, setResearching] = useState(false)
  const [showDrive, setShowDrive] = useState(false)
  const { toast, showToast } = useToast()
  const syncTimer = useRef(null)

  // ── Context bar ──
  const handleContextChange = (val) => {
    setContextDraft(val)
    setSynced(false)
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => {
      set('globalContext', val)
      setSynced(true)
    }, 600)
  }

  const handleResearch = async () => {
    const val = contextDraft.trim()
    if (!val) { showToast('Type a brand name first'); return }
    setResearching(true)
    try {
      const result = await claudeResearch(state.settings.anthropicKey, val)
      const updated = val + ' | ' + result
      setContextDraft(updated)
      set('globalContext', updated)
      setSynced(true)
      showToast('Context updated ✓')
    } catch (e) {
      showToast('Research failed: ' + e.message)
    } finally {
      setResearching(false)
    }
  }

  // ── Image import ──
  const handleFiles = useCallback(async (files) => {
    const arr = Array.from(files)
    const results = []
    for (const file of arr) {
      if (!file.type.startsWith('image/')) continue
      try {
        const dataUrl = await readFileAsDataUrl(file)
        const { w, h } = await getImageDimensions(dataUrl)
        results.push({
          id: 'img_' + Date.now() + Math.random(),
          name: file.name,
          dataUrl,
          width: w,
          height: h,
          orientation: getImageOrientation(w, h),
        })
      } catch {}
    }
    if (results.length) {
      set('images', [...state.images, ...results])
      showToast(`${results.length} image${results.length > 1 ? 's' : ''} loaded ✓`)
    }
  }, [state.images, set, showToast])

  return (
    <div className="shell">

      {/* ── TOPBAR ── */}
      <header className="topbar">
        <div className="logo-block">
          <div className="logo-main">KSS</div>
          <div className="logo-sub">Kshetej Sareen Studios</div>
        </div>

        <nav className="nav-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          <div className={`status-dot ${state.settings.metaToken ? 'connected' : ''}`} />
          <span style={{ fontSize: 10, color: 'var(--mute)', fontFamily: 'var(--font-mono)' }}>
            Meta: {state.settings.metaToken ? 'on' : 'off'}
          </span>
        </div>
      </header>

      {/* ── MAIN ── */}
      <div className="main-layout">

        {/* Context bar */}
        <div className="context-bar">
          <span className="context-bar-label">Brief</span>
          <input
            className="context-bar-input"
            value={contextDraft}
            onChange={e => handleContextChange(e.target.value)}
            placeholder="Brand name or project — e.g. RAVOH, luxury furniture, Delhi…"
          />
          <button className="research-btn" onClick={handleResearch} disabled={researching}>
            {researching ? <span className="spin" /> : '✦'} Research
          </button>
          {synced && contextDraft && (
            <span className="context-bar-synced">synced</span>
          )}
        </div>

        {/* Body */}
        <div className="main-body">

          {/* Sidebar */}
          <aside className="sidebar">
            <div className="sidebar-section">
              <div className="sidebar-section-title">Images</div>
              <div className="import-row">
                <label className="import-btn">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={e => handleFiles(e.target.files)}
                  />
                  <span className="import-btn-icon">↑</span>
                  Upload
                </label>
                <button className="import-btn" onClick={() => setShowDrive(true)}>
                  <span className="import-btn-icon" style={{ fontSize: 14 }}>
                    <svg width="16" height="14" viewBox="0 0 87.3 78" style={{ display: 'inline' }}>
                      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                      <path d="M43.65 25L29.9 1.2C28.55.4 27 0 25.45 0c-1.55 0-3.1.4-4.5 1.2L6.6 11.15c-1.4.8-2.55 1.95-3.3 3.3L27.5 53z" fill="#00ac47"/>
                      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.1-.4 4.5-1.2z" fill="#2684fc"/>
                      <path d="M73.4 14.45c-.8-1.4-1.95-2.55-3.3-3.3L55.8 1.2C54.45.4 52.9 0 51.35 0h-1.5L43.65 25l16.15 28h27.3c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                    </svg>
                  </span>
                  Drive
                </button>
              </div>

              {/* Image grid */}
              {state.images.length > 0 && (
                <>
                  <div className="img-grid" style={{ marginTop: 10 }}>
                    {state.images.map(img => (
                      <div
                        key={img.id}
                        className={`img-thumb ${state.selected.includes(img.id) ? 'selected' : ''}`}
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData('sidebar-img-id', img.id)
                          e.currentTarget.style.opacity = '.5'
                        }}
                        onDragEnd={e => e.currentTarget.style.opacity = '1'}
                        title={`${img.name} · ${img.orientation} · drag to plan grid`}
                      >
                        <img src={img.dataUrl} alt={img.name} loading="lazy" />
                        {img.orientation !== 'portrait' && (
                          <span className={`orient-badge ${img.orientation}`}>
                            {img.orientation === 'landscape' ? 'L' : 'S'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="img-count">{state.images.length} loaded</div>
                </>
              )}
            </div>
          </aside>

          {/* Content */}
          <main className="content">
            <div className={`tab-panel ${activeTab === 'plan' ? 'active' : ''}`}>
              <PlanTab showToast={showToast} onTabChange={setActiveTab} />
            </div>
            <div className={`tab-panel ${activeTab === 'studio' ? 'active' : ''}`}>
              <StudioTab showToast={showToast} />
            </div>
            <div className={`tab-panel ${activeTab === 'captions' ? 'active' : ''}`}>
              <CaptionsTab showToast={showToast} />
            </div>
            <div className={`tab-panel ${activeTab === 'schedule' ? 'active' : ''}`}>
              <ScheduleTab showToast={showToast} />
            </div>
            <div className={`tab-panel ${activeTab === 'settings' ? 'active' : ''}`}>
              <SettingsTab showToast={showToast} />
            </div>
          </main>
        </div>
      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="mobile-nav">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`mobile-nav-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── DRIVE MODAL ── */}
      {showDrive && (
        <DriveModal
          apiKey={state.settings.googleKey}
          onImport={imgs => {
            set('images', [...state.images, ...imgs])
            setShowDrive(false)
          }}
          onClose={() => setShowDrive(false)}
          showToast={showToast}
        />
      )}

      {/* ── TOAST ── */}
      <div className={`toast ${toast.show ? 'show' : ''}`}>{toast.msg}</div>
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <AppInner />
    </StoreProvider>
  )
}
