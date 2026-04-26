import { useState, useCallback, useRef, useEffect } from 'react'
import { StoreProvider, useStore, claudeResearch, readFileAsDataUrl, getImageDimensions, getImageOrientation } from './store.jsx'
import { useToast } from './hooks/useToast.js'
import { loadWorkspaces, saveWorkspace, getActiveWorkspaceId, setActiveWorkspaceId, generateWorkspaceId } from './utils/workspaces.js'
import DriveModal from './components/DriveModal.jsx'
import ClientPortal from './components/ClientPortal.jsx'
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
  const { state, set, setSettings, resetPlan } = useStore()
  const [activeTab, setActiveTab]           = useState('plan')
  const [contextDraft, setContextDraft]     = useState(state.globalContext)
  const [synced, setSynced]                 = useState(true)
  const [researching, setResearching]       = useState(false)
  const [showDrive, setShowDrive]           = useState(false)
  const [showPortal, setShowPortal]         = useState(false)
  const [showWorkspaces, setShowWorkspaces] = useState(false)
  const [workspaces, setWorkspaces]         = useState(loadWorkspaces)
  const [activeWsId, setActiveWsId]         = useState(getActiveWorkspaceId)
  const [notes, setNotes]                   = useState('')
  const { toast, showToast } = useToast()
  const syncTimer = useRef(null)

  // Universal save
  const saveSession = useCallback(() => {
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
    } catch(e) { showToast('Save failed') }
  }, [state, notes, showToast])

  // Load saved state on startup
  useEffect(() => {
    try {
      const s = localStorage.getItem('kss_settings')
      if (s) Object.entries(JSON.parse(s)).forEach(([k,v]) => setSettings({ [k]: v }))
      const c = localStorage.getItem('kss_global_context')
      if (c) { setContextDraft(c); set('globalContext', c) }
    } catch {}
  }, []) // eslint-disable-line

  // Context bar
  const handleContextChange = (val) => {
    setContextDraft(val); setSynced(false)
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => {
      set('globalContext', val)
      localStorage.setItem('kss_global_context', val)
      setSynced(true)
    }, 600)
  }

  const handleResearch = async () => {
    const val = contextDraft.trim()
    if (!val) { showToast('Type a brand name first'); return }
    setResearching(true)
    try {
      const withNotes = notes ? `${val}. Photographer notes: ${notes}` : val
      const result = await claudeResearch(state.settings.anthropicKey, withNotes)
      const updated = val + ' | ' + result
      setContextDraft(updated); set('globalContext', updated)
      localStorage.setItem('kss_global_context', updated)
      setSynced(true); showToast('Context updated ✓')
    } catch(e) { showToast('Research failed: ' + e.message) }
    finally { setResearching(false) }
  }

  // Image import
  const handleFiles = useCallback(async (files) => {
    const results = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      try {
        const dataUrl = await readFileAsDataUrl(file)
        const { w, h } = await getImageDimensions(dataUrl)
        results.push({ id: 'img_' + Date.now() + Math.random(), name: file.name, dataUrl, width: w, height: h, orientation: getImageOrientation(w, h) })
      } catch {}
    }
    if (results.length) {
      set('images', [...state.images, ...results])
      showToast(`${results.length} image${results.length > 1 ? 's' : ''} loaded ✓`)
    }
  }, [state.images, set, showToast])

  // Workspaces
  const saveCurrentWorkspace = useCallback(() => {
    const wsData = {
      name: contextDraft.split('|')[0].trim() || 'Untitled',
      globalContext: state.globalContext,
      plan: state.plan,
      images: state.images,
      postW: state.postW,
      postH: state.postH,
    }
    saveWorkspace(activeWsId, wsData)
    setWorkspaces(loadWorkspaces())
    showToast('Saved ✓')
  }, [activeWsId, state, contextDraft, showToast])

  const switchWorkspace = useCallback((wsId) => {
    saveCurrentWorkspace()
    const ws = workspaces[wsId]
    if (ws) {
      set('globalContext', ws.globalContext || '')
      setContextDraft(ws.globalContext || '')
      resetPlan(ws.plan || [])
      set('images', ws.images || [])
      set('postW', ws.postW || 1080)
      set('postH', ws.postH || 1350)
    }
    setActiveWorkspaceId(wsId); setActiveWsId(wsId)
    setShowWorkspaces(false)
    showToast(`Switched to ${ws?.name || 'project'} ✓`)
  }, [workspaces, saveCurrentWorkspace, set, resetPlan, showToast])

  const createWorkspace = useCallback(() => {
    saveCurrentWorkspace()
    const id = generateWorkspaceId()
    saveWorkspace(id, { name: 'New Project', globalContext: '', plan: [], images: [], postW: 1080, postH: 1350, savedAt: new Date().toISOString() })
    setWorkspaces(loadWorkspaces())
    setActiveWorkspaceId(id); setActiveWsId(id)
    set('globalContext', ''); setContextDraft('')
    resetPlan([]); set('images', [])
    setShowWorkspaces(false)
    showToast('New project created ✓')
  }, [saveCurrentWorkspace, set, resetPlan, showToast])

  return (
    <div className="shell">

      {/* Workspace backdrop */}
      {showWorkspaces && (
        <div
          onClick={() => setShowWorkspaces(false)}
          style={{ position:'fixed', inset:0, top:52, background:'rgba(0,0,0,.6)', zIndex:499 }}
        />
      )}

      {/* ── TOPBAR ── */}
      <header className="topbar">

        {/* Logo + workspace switcher */}
        <div className="logo-block" onClick={() => setShowWorkspaces(w => !w)}>
          <div className="logo-kss">KSS</div>
          <div className="logo-sep" />
          <div className="logo-sub">Studio ▾</div>

          {/* Workspace dropdown */}
          {showWorkspaces && (
            <div className="ws-dropdown open" onClick={e => e.stopPropagation()}>
              <div className="ws-dropdown-label">Projects</div>
              {Object.entries(workspaces).map(([id, ws]) => (
                <div key={id}
                  className={`ws-item ${id === activeWsId ? 'active' : ''}`}
                  onClick={() => switchWorkspace(id)}>
                  <div className="ws-item-name">{ws.name}</div>
                  <div className="ws-item-meta">
                    {ws.plan?.filter(p=>p.imageIndex).length || 0} posts · {new Date(ws.savedAt || Date.now()).toLocaleDateString()}
                  </div>
                </div>
              ))}
              <div className="ws-footer">
                <button className="ws-footer-btn" onClick={e => { e.stopPropagation(); createWorkspace() }}>+ New Project</button>
                <button className="ws-footer-btn" onClick={e => { e.stopPropagation(); saveCurrentWorkspace() }}>💾 Save</button>
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="nav">
          {TABS.map(tab => (
            <button key={tab.id}
              className={`nav-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => { setActiveTab(tab.id); setShowWorkspaces(false) }}>
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Right */}
        <div className="topbar-right">
          <button className="ws-btn" onClick={saveSession} title="Save entire session — plan, captions, schedule">↓ Save</button>
          <button className="ws-btn" onClick={() => setShowPortal(true)}>⬡ Client</button>
          <div className="meta-status">
            <div className={`status-dot ${state.settings.metaToken ? 'live' : ''}`} />
            <span>Meta: {state.settings.metaToken ? 'on' : 'off'}</span>
          </div>
        </div>
      </header>

      {/* ── BRIEF BAR ── */}
      <div className="brief-bar">
        <span className="brief-label">Brief</span>
        <input
          className="brief-input"
          value={contextDraft}
          onChange={e => handleContextChange(e.target.value)}
          placeholder="Brand name or project — e.g. RAVOH, luxury furniture, Delhi…"
        />
        <span style={{ color: 'var(--text-3)', fontSize: 9, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>·</span>
        <input
          style={{ width: 180, flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 10, outline: 'none' }}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="your notes…"
        />
        <button className="research-btn" onClick={handleResearch} disabled={researching}>
          {researching ? <span className="spin" /> : '✦'} Research
        </button>
        {synced && contextDraft && <span className="synced-tag">synced</span>}
      </div>

      {/* ── MAIN ── */}
      <div className="main" onClick={() => setShowWorkspaces(false)}>

        {/* Sidebar */}
        <aside className="sidebar">
          <label className="upload-btn">
            <input type="file" multiple accept="image/*" style={{ display:'none' }}
              onChange={e => handleFiles(e.target.files)} />
            <span className="upload-icon">↑</span>
            <span>Upload</span>
          </label>
          <div className="upload-btn" onClick={e => { e.stopPropagation(); setShowDrive(true) }}>
            <svg width="20" height="17" viewBox="0 0 87.3 78">
              <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
              <path d="M43.65 25L29.9 1.2C28.55.4 27 0 25.45 0c-1.55 0-3.1.4-4.5 1.2L6.6 11.15c-1.4.8-2.55 1.95-3.3 3.3L27.5 53z" fill="#00ac47"/>
              <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.1-.4 4.5-1.2z" fill="#2684fc"/>
              <path d="M73.4 14.45c-.8-1.4-1.95-2.55-3.3-3.3L55.8 1.2C54.45.4 52.9 0 51.35 0h-1.5L43.65 25l16.15 28h27.3c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
            </svg>
            <span>Drive</span>
          </div>
          {state.images.length > 0 && (
            <div className="sidebar-count">
              <strong>{state.images.length}</strong>
              imgs
            </div>
          )}
        </aside>

        {/* Content area */}
        <main style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {TABS.map(tab => (
            <div key={tab.id} style={{ display: activeTab === tab.id ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              {tab.id === 'plan'     && <PlanTab     showToast={showToast} onTabChange={setActiveTab} />}
              {tab.id === 'studio'   && <StudioTab   showToast={showToast} />}
              {tab.id === 'captions' && <CaptionsTab showToast={showToast} />}
              {tab.id === 'schedule' && <ScheduleTab showToast={showToast} />}
              {tab.id === 'settings' && <SettingsTab showToast={showToast} />}
            </div>
          ))}
        </main>

        {/* Right panel — managed by PlanTab itself */}
      </div>

      {/* Mobile nav */}
      <nav className="mobile-nav">
        {TABS.map(tab => (
          <button key={tab.id}
            className={`mobile-nav-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Modals */}
      {showDrive && (
        <DriveModal
          apiKey={state.settings.googleKey}
          onImport={imgs => { set('images', [...state.images, ...imgs]); setShowDrive(false) }}
          onClose={() => setShowDrive(false)}
          showToast={showToast}
        />
      )}
      {showPortal && <ClientPortal onClose={() => setShowPortal(false)} showToast={showToast} />}

      {/* Toast */}
      <div className={`toast ${toast.show ? 'show' : ''}`}>{toast.msg}</div>
    </div>
  )
}

export default function App() {
  return <StoreProvider><AppInner /></StoreProvider>
}
