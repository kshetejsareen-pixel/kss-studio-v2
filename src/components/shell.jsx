// The frame around every step: the step rail, top bar, "next" bar, mobile nav, and the
// screens shown instead of the app (passcode, second tab).
import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import Tip from './Tip.jsx'
import { Btn, IconBtn, Modal, Spinner } from './ui.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { stepStatuses, nextAction } from '../store/selectors.js'
import { STEPS, EXTRA_STEPS, stepInfo } from '../data/model.js'
import { runtime } from '../lib/runtime.js'
import { cloudinaryConfigured } from '../lib/cloudinary.js'
import { usage } from '../data/db.js'

export const CANONICAL_ORIGIN = 'https://studio.kshetejsareen.com'
const RAIL_KEY = 'kss_rail_collapsed'

const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname) || window.location.hostname.endsWith('.localhost')
export const onCanonical = () => window.location.origin === CANONICAL_ORIGIN || isLocal()

export function formatBytes(n) {
  if (!n) return '0 MB'
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`
  return `${Math.max(0.1, n / 1e6).toFixed(1)} MB`
}

export function useStorage() {
  const [u, setU] = useState({ usage: 0, quota: 0 })
  const { doc } = useStore()
  const count = doc.images.length
  useEffect(() => {
    let alive = true
    usage().then((v) => { if (alive) setU(v) })
    return () => { alive = false }
  }, [count])
  return u
}

// Connection dots for the rail and Settings.
export function useConnections() {
  const { settings, session, metaState, skipServer } = useStore()
  const live = session.server && session.authed && !skipServer
  const f = session.features || {}
  const claude = live && f.claude
    ? { tone: 'ok', text: 'Claude · server' }
    : settings.anthropicKey || settings.proxyUrl
      ? { tone: 'ok', text: 'Claude · browser key' }
      : { tone: 'off', text: 'Claude · not connected' }
  let meta = { tone: 'off', text: 'Instagram · not connected' }
  if (metaState) {
    if (!metaState.ok) meta = { tone: 'bad', text: `Instagram · ${metaState.error || 'error'}` }
    else if (!settings.igAccountId) meta = { tone: 'warn', text: 'Instagram · pick an account' }
    else if (metaState.expiresAt) {
      const days = Math.floor((metaState.expiresAt - Date.now()) / 86400000)
      meta = days < 7 ? { tone: 'warn', text: `Instagram · token ends in ${Math.max(0, days)}d` } : { tone: 'ok', text: `Instagram · ${metaState.name || 'connected'}` }
    } else meta = { tone: 'ok', text: `Instagram · ${metaState.name || 'connected'}` }
  }
  const cloud = cloudinaryConfigured(settings)
    ? { tone: 'ok', text: runtime.session.cloudMode === 'server' ? 'Cloudinary · server' : 'Cloudinary · preset' }
    : { tone: 'off', text: 'Cloudinary · not set' }
  const drive = settings.googleKey ? { tone: 'ok', text: 'Google Drive · key set' } : { tone: 'off', text: 'Google Drive · no key' }
  return { claude, meta, cloud, drive }
}

const Dot = ({ tone }) => <span className={`dot ${tone}`} />

// ---- Step rail ------------------------------------------------------------------------

export function StepRail() {
  const { doc, route, go, settings, updateSettings, workspaces, activeId, switchWorkspace } = useStore()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false }
  })
  const statuses = useMemo(() => stepStatuses(doc), [doc])
  const conn = useConnections()
  const store = useStorage()
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(RAIL_KEY, c ? '0' : '1') } catch { /* ignore */ }
      return !c
    })
  }
  const pct = store.quota ? Math.round((store.usage / store.quota) * 100) : 0

  return (
    <nav className={`rail ${collapsed ? 'collapsed' : ''}`} aria-label="Steps">
      <div className="rail-head">
        {!collapsed && <span className="brand">KSS <em>Studio</em></span>}
        <IconBtn icon={collapsed ? 'expand' : 'collapse'} label={collapsed ? 'Expand' : 'Collapse'} onClick={toggle} />
      </div>
      <ol className="rail-steps">
        {STEPS.map((s, i) => {
          const st = statuses[s.id] || {}
          const on = route.step === s.id
          const item = (
            <li key={s.id}>
              <button type="button" className={`rail-item ${on ? 'on' : ''} ${st.done ? 'done' : ''}`} onClick={() => go(s.id)} aria-current={on ? 'step' : undefined}>
                <span className="rail-num">{st.done ? <Icon name="check" size={12} /> : i + 1}</span>
                <Icon name={s.icon} size={16} />
                {!collapsed && (
                  <span className="rail-text">
                    <span className="rail-label">{s.label}</span>
                    <span className={`rail-status ${st.tone || 'mute'}`}>{st.text || s.hint}</span>
                  </span>
                )}
              </button>
            </li>
          )
          return collapsed ? <Tip key={s.id} text={`${s.label} — ${st.text || s.hint}`}>{item}</Tip> : item
        })}
      </ol>
      <div className="rail-extra">
        {EXTRA_STEPS.map((s) => (
          <button key={s.id} type="button" className={`rail-item small ${route.step === s.id ? 'on' : ''}`} onClick={() => go(s.id)} aria-label={s.label}>
            <Icon name={s.icon} size={15} />
            {!collapsed && <span className="rail-label">{s.label}</span>}
          </button>
        ))}
      </div>
      <div className="rail-foot">
        {!collapsed && (
          <>
            <button type="button" className="rail-conn" onClick={() => go('settings')}>
              {Object.values(conn).map((c) => (
                <span key={c.text} className="conn-line"><Dot tone={c.tone} />{c.text}</span>
              ))}
            </button>
            {workspaces.length > 1 && (
              <select className="rail-ws" value={activeId || ''} onChange={(e) => switchWorkspace(e.target.value)} aria-label="Workspace">
                {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            )}
            <div className="rail-storage">
              <span className="label">Storage</span>
              <span>{formatBytes(store.usage)}{store.quota ? ` · ${pct}%` : ''}</span>
            </div>
          </>
        )}
        <IconBtn
          icon={settings.theme === 'light' ? 'moon' : 'sun'}
          label={settings.theme === 'light' ? 'Dark theme' : 'Light theme'}
          onClick={() => updateSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' })}
        />
      </div>
    </nav>
  )
}

// ---- Top bar --------------------------------------------------------------------------

const time = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })

export function TopBar({ actions }) {
  const { route, workspaces, activeId, savedAt, meta, backup, toast } = useStore()
  const info = stepInfo(route.step)
  const ws = workspaces.find((w) => w.id === activeId)
  const [busy, setBusy] = useState(false)
  const stale = !meta.lastBackupAt || Date.now() - Date.parse(meta.lastBackupAt) > 7 * 86400000
  const doBackup = async () => {
    setBusy(true)
    try {
      await backup({ includeImages: true })
      toast('Backup downloaded', { kind: 'success' })
    } catch (err) {
      toast(err?.message || 'Backup failed.', { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {!onCanonical() && (
        <div className="banner warn" role="alert">
          <Icon name="warning" size={14} />
          <span>You’re on the old address. Your work is stored per address — download a backup here and restore it at <a href={CANONICAL_ORIGIN}>studio.kshetejsareen.com</a>.</span>
          <Btn size="sm" kind="ghost" icon="download" busy={busy} onClick={doBackup}>Backup</Btn>
        </div>
      )}
      <header className="topbar">
        <div className="topbar-title">
          <span className="label">{ws?.name || 'Workspace'}</span>
          <h1>{info.label}</h1>
          <span className="topbar-hint">{info.hint}</span>
        </div>
        <div className="topbar-actions">
          {actions}
          <span className="saved">{savedAt ? `Saved ${time(savedAt)}` : 'Saved'}</span>
          <Btn size="sm" kind={stale ? '' : 'ghost'} icon="download" busy={busy} onClick={doBackup} tip={meta.lastBackupAt ? `Last backup ${new Date(meta.lastBackupAt).toLocaleDateString('en-IN')}` : 'No backup yet — your work lives only in this browser'}>
            Backup
          </Btn>
        </div>
      </header>
    </>
  )
}

// ---- Next bar -------------------------------------------------------------------------

export function NextBar() {
  const { doc, route, go } = useStore()
  const next = useMemo(() => nextAction(doc, route.step), [doc, route.step])
  if (!next) return null
  const info = stepInfo(next.step)
  return (
    <div className="nextbar">
      <span className="label">Next</span>
      <button type="button" className="nextbar-btn" onClick={() => go(next.step)}>
        <span>{next.label}</span>
        <span className="nextbar-step">{info.label}</span>
        <Icon name="arrowRight" size={14} />
      </button>
    </div>
  )
}

// ---- Mobile nav -----------------------------------------------------------------------

export function MobileNav() {
  const { route, go } = useStore()
  const [more, setMore] = useState(false)
  const main = STEPS.filter((s) => ['library', 'plan', 'write', 'schedule'].includes(s.id))
  return (
    <>
      <nav className="mobile-nav" aria-label="Steps">
        {main.map((s) => (
          <button key={s.id} type="button" className={route.step === s.id ? 'on' : ''} onClick={() => go(s.id)}>
            <Icon name={s.icon} size={18} />
            <span>{s.label}</span>
          </button>
        ))}
        <button type="button" className={more ? 'on' : ''} onClick={() => setMore(true)}>
          <Icon name="menu" size={18} />
          <span>More</span>
        </button>
      </nav>
      {more && (
        <Modal title="Steps" onClose={() => setMore(false)} width={360}>
          <div className="mobile-steps">
            {[...STEPS, ...EXTRA_STEPS].map((s) => (
              <button key={s.id} type="button" className={`rail-item ${route.step === s.id ? 'on' : ''}`} onClick={() => { go(s.id); setMore(false) }}>
                <Icon name={s.icon} size={16} />
                <span className="rail-text"><span className="rail-label">{s.label}</span><span className="rail-status mute">{s.hint}</span></span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}

// ---- Gates ----------------------------------------------------------------------------

export function PasscodeScreen() {
  const { login, useWithoutServer } = useStore()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    if (!code) return
    setBusy(true)
    setError('')
    const res = await login(code)
    setBusy(false)
    if (!res.ok) setError(res.error || 'Wrong passcode.')
  }
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <span className="brand big">KSS <em>Studio</em></span>
        <p>Enter the studio passcode. It unlocks Claude, Instagram and Cloudinary on the server, so no keys live in this browser.</p>
        <input type="password" autoComplete="current-password" placeholder="Passcode" value={code} onChange={(e) => setCode(e.target.value)} autoFocus aria-label="Passcode" />
        {error && <p className="error-text">{error}</p>}
        <Btn kind="primary" type="submit" busy={busy} icon="key">Unlock</Btn>
        <button type="button" className="link-btn" onClick={useWithoutServer}>Continue without server (keys stored in this browser)</button>
      </form>
    </div>
  )
}

export function LockOverlay() {
  const { takeOver } = useStore()
  return (
    <div className="gate overlay">
      <div className="gate-card">
        <Icon name="lock" size={24} />
        <h2>Open in another tab</h2>
        <p>KSS Studio is already open in another tab or window. Only one tab saves and publishes at a time, so nothing gets overwritten or posted twice.</p>
        <Btn kind="primary" icon="arrowRight" onClick={takeOver}>Use here</Btn>
      </div>
    </div>
  )
}

export function Loading({ text = 'Opening your studio…' }) {
  return (
    <div className="gate">
      <div className="gate-card center">
        <Spinner size={20} />
        <p>{text}</p>
      </div>
    </div>
  )
}
