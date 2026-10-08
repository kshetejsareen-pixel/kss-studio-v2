// Settings: how the studio connects (server or browser keys), the Instagram account,
// profile defaults, workspaces, and the data kept in this browser.
import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Btn, Field, Segmented, Modal, Meter, ProgressBar, confirmAction, useRunner } from '../components/ui.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { useConnections, useStorage, formatBytes } from '../components/shell.jsx'
import { DEFAULT_MODELS, MODEL_OPTIONS, modelLabel } from '../lib/api.js'
import { findAccounts, REQUIRED_SCOPES } from '../lib/meta.js'
import { runtime } from '../lib/runtime.js'
import { persist, isPersisted } from '../data/db.js'
import { hasV2Data, clearV2Data } from '../data/migrate.js'
import { formatIst, relativeTime } from '../lib/time.js'

const TIERS = [
  ['opus', 'Deep work', 'Planning, design, ad copy'],
  ['sonnet', 'Everyday', 'Captions, analysis'],
  ['haiku', 'Quick', 'Tags and small checks'],
]

export default function Settings() {
  const conn = useConnections()
  const { session, skipServer } = useStore()
  const server = session.server && !skipServer
  return (
    <div className="page settings">
      <div className="settings-grid">
        <section className="card settings-card">
          <h3><Icon name="bolt" size={15} /> Connections</h3>
          <ul className="conn-list">
            {Object.entries(conn).map(([id, c]) => (
              <li key={id}><span className={`dot ${c.tone}`} /> {c.text}</li>
            ))}
          </ul>
          <SessionPanel />
        </section>

        <ProfileCard />
        <InstagramCard server={server} />
        <ClaudeCard server={server} />
        <MediaCard />
        <WorkspacesCard />
        <DataCard />
        <AppearanceCard />
      </div>
    </div>
  )
}

// ---- Session ----------------------------------------------------------------------

function SessionPanel() {
  const { session, skipServer, login, logout, refreshSession } = useStore()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const { busy, run } = useRunner()

  if (!session.server) {
    return <p className="field-hint">No studio server reached — keys below are stored in this browser only. On the live site the server keeps them safe.</p>
  }
  if (skipServer || !session.authed) {
    const submit = async (e) => {
      e.preventDefault()
      setError('')
      const res = await run('login', () => login(code))
      if (res && !res.ok) setError(res.error)
      if (res?.ok) setCode('')
    }
    return (
      <form className="session-form" onSubmit={submit}>
        <p className="field-hint">{skipServer ? 'Using browser keys for this tab.' : 'The studio server is locked.'} Sign in to use the keys kept on the server.</p>
        <div className="field-row">
          <input type="password" autoComplete="current-password" placeholder="Passcode" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Passcode" />
          <Btn type="submit" kind="primary" icon="unlock" busy={busy === 'login'} disabled={!code}>Sign in</Btn>
        </div>
        {error && <p className="field-hint bad">{error}</p>}
      </form>
    )
  }
  return (
    <div className="session-row">
      <span><Icon name="lock" size={13} /> Signed in to the studio server. Keys stay on the server.</span>
      <span className="spacer" />
      <Btn size="sm" kind="ghost" icon="refresh" onClick={() => run('session', refreshSession)}>Recheck</Btn>
      <Btn size="sm" kind="ghost" icon="logout" onClick={() => run('logout', logout)}>Sign out</Btn>
    </div>
  )
}

// A key or token: never shown back in full, only replaced or cleared.
function SecretField({ label, hint, value, onChange, placeholder }) {
  const [editing, setEditing] = useState(!value)
  const [text, setText] = useState('')
  useEffect(() => { if (!value) setEditing(true) }, [value])
  if (!editing) {
    return (
      <Field label={label} hint={hint} group>
        <div className="secret-row">
          <code>•••• {String(value).slice(-4)}</code>
          <span className="spacer" />
          <Btn size="sm" kind="ghost" onClick={() => { setText(''); setEditing(true) }}>Replace</Btn>
          <Btn size="sm" kind="ghost" icon="trash" onClick={async () => { if (await confirmAction(`Remove the saved ${label.toLowerCase()}?`, { ok: 'Remove', danger: true })) onChange('') }}>Remove</Btn>
        </div>
      </Field>
    )
  }
  const save = () => {
    if (text.trim()) {
      onChange(text.trim())
      setEditing(false)
    }
  }
  return (
    <Field label={label} hint={hint} group>
      <div className="secret-row">
        <input type="password" autoComplete="off" spellCheck={false} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        <Btn size="sm" kind="primary" disabled={!text.trim()} onClick={save}>Save</Btn>
        {value && <Btn size="sm" kind="ghost" onClick={() => setEditing(false)}>Cancel</Btn>}
      </div>
    </Field>
  )
}

const LocalNote = () => <span className="local-note"><Icon name="warning" size={12} /> Stored in this browser only</span>

// ---- Profile ----------------------------------------------------------------------

function ProfileCard() {
  const { settings, updateSettings } = useStore()
  return (
    <section className="card settings-card">
      <h3><Icon name="user" size={15} /> Profile</h3>
      <Field label="Instagram handle">
        <input value={settings.handle} onChange={(e) => updateSettings({ handle: e.target.value })} placeholder="@yourstudio" />
      </Field>
      <Field label="Website" hint="Used as the link in ads and the client review.">
        <input value={settings.website} onChange={(e) => updateSettings({ website: e.target.value })} placeholder="www.example.com" />
      </Field>
      <Field label="Signature hashtags" hint="Offered first when Claude picks hashtags. Instagram counts at most 5 per post.">
        <input value={settings.hashtags} onChange={(e) => updateSettings({ hashtags: e.target.value })} placeholder="#yourstudio #commercialphotography" />
      </Field>
    </section>
  )
}

// ---- Instagram & Meta --------------------------------------------------------------

function InstagramCard({ server }) {
  const { settings, updateSettings, metaState, refreshMeta, toast } = useStore()
  const { busy, run } = useRunner()
  const [found, setFound] = useState(null)
  const metaServer = runtime.session.metaMode === 'server'

  const check = () => run('check', async () => {
    const s = await refreshMeta()
    if (!s) toast('Add a Meta token first.')
    else if (s.ok) toast(`Connected as ${s.name || 'your account'}`, { kind: 'success' })
  })
  const find = () => run('find', async () => {
    const res = await findAccounts()
    setFound(res)
    const withIg = res.pages.filter((p) => p.ig)
    if (withIg.length === 1 && !settings.igAccountId) {
      updateSettings({ pageId: withIg[0].id, igAccountId: withIg[0].ig.id })
      toast(`Using @${withIg[0].ig.username}`, { kind: 'success' })
    }
    if (res.adAccounts.length === 1 && !settings.adAccountId) updateSettings({ adAccountId: res.adAccounts[0].id })
  })

  return (
    <section className="card settings-card">
      <h3><Icon name="share" size={15} /> Instagram &amp; Meta</h3>
      {metaServer
        ? <p className="field-hint"><Icon name="lock" size={12} /> The Meta token is kept on the studio server.</p>
        : (
          <>
            <SecretField
              label="Meta access token"
              hint={server ? 'The server has no Meta token, so this browser token is used.' : 'A long-lived user or system-user token from Meta for Developers.'}
              value={settings.metaToken}
              onChange={(metaToken) => updateSettings({ metaToken })}
              placeholder="EAA…"
            />
            {settings.metaToken && <LocalNote />}
          </>
        )}
      <div className="btn-row">
        <Btn size="sm" kind="ghost" icon="refresh" busy={busy === 'check'} onClick={check}>Check connection</Btn>
        <Btn size="sm" kind="ghost" icon="search" busy={busy === 'find'} disabled={!metaServer && !settings.metaToken} onClick={find} tip="Lists your Facebook Pages, their Instagram accounts and your ad accounts">Find my accounts</Btn>
      </div>
      {metaState && (
        <div className={`meta-state ${metaState.ok ? 'ok' : 'bad'}`}>
          {metaState.ok
            ? <p><Icon name="check" size={13} /> {metaState.name || 'Connected'}{metaState.expiresAt ? ` · token ends ${formatIst(metaState.expiresAt, { dateStyle: 'medium' })}` : metaState.expiresAt === 0 ? ' · token does not expire' : ''}</p>
            : <p><Icon name="x" size={13} /> {metaState.error}</p>}
          {metaState.missing?.length > 0 && <p className="field-hint warn">Missing permissions: {metaState.missing.join(', ')}. Needed: {REQUIRED_SCOPES.join(', ')}.</p>}
        </div>
      )}
      {found && (
        <div className="found">
          {found.pages.length === 0 && <p className="field-hint">No Facebook Pages on this token.</p>}
          {found.pages.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`found-row ${settings.pageId === p.id ? 'on' : ''}`}
              disabled={!p.ig}
              onClick={() => updateSettings({ pageId: p.id, igAccountId: p.ig.id })}
            >
              <Icon name={settings.pageId === p.id ? 'check' : 'single'} size={13} />
              <span>{p.name}</span>
              <span className="mute">{p.ig ? `@${p.ig.username}` : 'No Instagram linked'}</span>
            </button>
          ))}
          {found.adAccounts.map((a) => (
            <button key={a.id} type="button" className={`found-row ${settings.adAccountId === a.id ? 'on' : ''}`} onClick={() => updateSettings({ adAccountId: a.id })}>
              <Icon name={settings.adAccountId === a.id ? 'check' : 'megaphone'} size={13} />
              <span>{a.name}</span>
              <span className="mute">Ad account · {a.currency}</span>
            </button>
          ))}
        </div>
      )}
      <details className="advanced">
        <summary>Account IDs</summary>
        <Field label="Instagram account ID"><input value={settings.igAccountId} onChange={(e) => updateSettings({ igAccountId: e.target.value.trim() })} /></Field>
        <Field label="Facebook Page ID"><input value={settings.pageId} onChange={(e) => updateSettings({ pageId: e.target.value.trim() })} /></Field>
        <Field label="Ad account ID"><input value={settings.adAccountId} onChange={(e) => updateSettings({ adAccountId: e.target.value.trim() })} placeholder="act_…" /></Field>
      </details>
    </section>
  )
}

// ---- Claude -----------------------------------------------------------------------

function ClaudeCard({ server }) {
  const { settings, updateSettings, session } = useStore()
  const claudeServer = server && session.authed && session.features?.claude
  const models = { ...DEFAULT_MODELS, ...(settings.models || {}) }
  const setModel = (tier, id) => updateSettings((s) => ({ ...s, models: { ...(s.models || {}), [tier]: id } }))
  return (
    <section className="card settings-card">
      <h3><Icon name="sparkle" size={15} /> Claude</h3>
      {claudeServer && <p className="field-hint"><Icon name="lock" size={12} /> The Anthropic key is kept on the studio server.</p>}
      {TIERS.map(([tier, label, hint]) => (
        <Field key={tier} label={label} hint={hint}>
          <select value={models[tier]} onChange={(e) => setModel(tier, e.target.value)}>
            {MODEL_OPTIONS[tier].map((id) => <option key={id} value={id}>{modelLabel(id)}</option>)}
          </select>
        </Field>
      ))}
      {!claudeServer && (
        <details className="advanced" open={!settings.anthropicKey && !settings.proxyUrl}>
          <summary>Browser key</summary>
          <SecretField label="Anthropic API key" value={settings.anthropicKey} onChange={(anthropicKey) => updateSettings({ anthropicKey })} placeholder="sk-ant-…" />
          <Field label="Proxy URL" hint="Optional. A worker that adds the key for you, instead of keeping it here.">
            <input value={settings.proxyUrl} onChange={(e) => updateSettings({ proxyUrl: e.target.value.trim() })} placeholder="https://…workers.dev" />
          </Field>
          {settings.proxyUrl && <SecretField label="Proxy secret" value={settings.proxySecret} onChange={(proxySecret) => updateSettings({ proxySecret })} />}
          {(settings.anthropicKey || settings.proxySecret) && <LocalNote />}
        </details>
      )}
    </section>
  )
}

// ---- Cloudinary + Drive -----------------------------------------------------------

function MediaCard() {
  const { settings, updateSettings } = useStore()
  const cloudServer = runtime.session.cloudMode === 'server'
  return (
    <section className="card settings-card">
      <h3><Icon name="cloud" size={15} /> Image hosting &amp; Drive</h3>
      <p className="field-hint">Instagram fetches each picture from a public link, so publishing uploads it to Cloudinary first (free plan).</p>
      {cloudServer
        ? <p className="field-hint"><Icon name="lock" size={12} /> Uploads are signed by the studio server.</p>
        : (
          <>
            <Field label="Cloud name"><input value={settings.cloudName} onChange={(e) => updateSettings({ cloudName: e.target.value.trim() })} /></Field>
            <Field label="Unsigned upload preset"><input value={settings.cloudPreset} onChange={(e) => updateSettings({ cloudPreset: e.target.value.trim() })} /></Field>
          </>
        )}
      <SecretField
        label="Google API key"
        hint="For importing from shared Google Drive folders. Restrict it to the Drive API and this site."
        value={settings.googleKey}
        onChange={(googleKey) => updateSettings({ googleKey })}
        placeholder="AIza…"
      />
      {settings.googleKey && <LocalNote />}
    </section>
  )
}

// ---- Workspaces -------------------------------------------------------------------

function WorkspacesCard() {
  const { workspaces, activeId, switchWorkspace, createWorkspace, renameWorkspace, deleteWorkspace, toast } = useStore()
  const [name, setName] = useState('')
  const add = async () => {
    const ws = await createWorkspace(name)
    setName('')
    toast(`Switched to ${ws.name}`, { kind: 'success' })
  }
  const remove = async (w) => {
    if (!(await confirmAction(`Delete the workspace “${w.name}” with all its posts and pictures? This can't be undone — make a backup first if unsure.`, { ok: 'Delete workspace', danger: true }))) return
    deleteWorkspace(w.id)
  }
  return (
    <section className="card settings-card">
      <h3><Icon name="layers" size={15} /> Workspaces</h3>
      <p className="field-hint">One per client or project. Each has its own brief, pictures and grid.</p>
      <ul className="ws-list">
        {workspaces.map((w) => (
          <li key={w.id} className={w.id === activeId ? 'on' : ''}>
            <input defaultValue={w.name} aria-label="Workspace name" onBlur={(e) => { if (e.target.value.trim() && e.target.value !== w.name) renameWorkspace(w.id, e.target.value) }} />
            {w.id === activeId
              ? <span className="mute">Open</span>
              : <Btn size="sm" kind="ghost" onClick={() => switchWorkspace(w.id)}>Open</Btn>}
            <Btn size="sm" kind="ghost" icon="trash" disabled={workspaces.length < 2} onClick={() => remove(w)} tip="Delete workspace" />
          </li>
        ))}
      </ul>
      <div className="field-row">
        <input value={name} placeholder="New workspace name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        <Btn size="sm" kind="ghost" icon="plus" onClick={add}>Add</Btn>
      </div>
    </section>
  )
}

// ---- Data -------------------------------------------------------------------------

function DataCard() {
  const { meta, backup, inspectBackup, restore, importV2, toast } = useStore()
  const store = useStorage()
  const { busy, run } = useRunner()
  const [persisted, setPersisted] = useState(null)
  const [withImages, setWithImages] = useState(true)
  const [progress, setProgress] = useState(null)
  const [pending, setPending] = useState(null)
  const [v2, setV2] = useState(() => hasV2Data())
  const fileRef = useRef(null)
  const pct = store.quota ? Math.round((store.usage / store.quota) * 100) : 0

  useEffect(() => { isPersisted().then(setPersisted) }, [])

  const keep = async () => {
    const ok = await persist()
    setPersisted(ok)
    toast(ok ? 'The browser will keep this data.' : 'The browser declined. Bookmarking or installing the site usually helps.', { kind: ok ? 'success' : 'info' })
  }
  const track = (label) => {
    const startedAt = Date.now()
    setProgress({ label, startedAt })
    return (done, total) => setProgress({ label, done, total, startedAt })
  }
  const doBackup = () => run('backup', async () => {
    const out = await backup({ includeImages: withImages, onProgress: track('Backing up') }).finally(() => setProgress(null))
    toast(`Backup saved — ${out.workspaces} workspace${out.workspaces > 1 ? 's' : ''}, ${out.images} pictures`, { kind: 'success' })
  })
  const pick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run('inspect', async () => setPending({ file, parsed: await inspectBackup(file) }))
  }
  const doRestore = () => run('restore', async () => {
    await restore(pending.file, pending.parsed, { onProgress: track('Restoring') }).finally(() => setProgress(null))
    setPending(null)
    toast('Backup restored', { kind: 'success' })
  })
  const clearOld = async () => {
    if (!(await confirmAction('Remove the old v2 data from this browser? Import it first if you have not — this cannot be undone.', { ok: 'Remove v2 data', danger: true }))) return
    clearV2Data()
    setV2(false)
    toast('Old v2 data removed')
  }

  return (
    <section className="card settings-card">
      <h3><Icon name="database" size={15} /> Data</h3>
      <p className="field-hint">Everything lives in this browser. Back up regularly — clearing site data deletes it.</p>
      <div className="usage">
        <span>{formatBytes(store.usage)} of {formatBytes(store.quota)}</span>
        <Meter value={pct} tone={pct > 80 ? 'bad' : 'ok'} />
      </div>
      <div className="session-row">
        <span>{persisted ? <><Icon name="lock" size={13} /> Protected from automatic clean-up</> : 'The browser may clear this data when space runs low.'}</span>
        <span className="spacer" />
        {!persisted && <Btn size="sm" kind="ghost" onClick={keep}>Keep data</Btn>}
      </div>
      <div className="btn-row">
        <Btn kind="primary" icon="download" busy={busy === 'backup'} onClick={doBackup}>Back up</Btn>
        <label className="check"><input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} /> Include pictures</label>
        <Btn kind="ghost" icon="upload" busy={busy === 'inspect'} onClick={() => fileRef.current?.click()}>Restore…</Btn>
        <input ref={fileRef} type="file" accept=".kssb,application/octet-stream" hidden onChange={pick} />
      </div>
      <p className="field-hint">{meta.lastBackupAt ? `Last backup ${relativeTime(meta.lastBackupAt)}.` : 'No backup yet.'}</p>
      {progress && !pending && <ProgressBar {...progress} />}
      {v2 && (
        <div className="banner info">
          <Icon name="info" size={14} />
          <span>Data from the old version is still in this browser.</span>
          <Btn size="sm" kind="ghost" onClick={() => run('v2', importV2)}>Import again</Btn>
          <Btn size="sm" kind="ghost" onClick={clearOld}>Remove</Btn>
        </div>
      )}
      {pending && (
        <Modal
          title="Restore backup"
          onClose={busy ? undefined : () => setPending(null)}
          width={460}
          footer={<><Btn kind="ghost" disabled={!!busy} onClick={() => setPending(null)}>Cancel</Btn><Btn kind="primary" busy={busy === 'restore'} onClick={doRestore}>Restore</Btn></>}
        >
          <p>{pending.parsed.manifest.workspaces.length} workspace{pending.parsed.manifest.workspaces.length > 1 ? 's' : ''} and {pending.parsed.manifest.blobs.length} pictures{pending.parsed.manifest.exportedAt ? `, saved ${formatIst(pending.parsed.manifest.exportedAt)}` : ''}.</p>
          <p className="field-hint warn">Workspaces with the same name and id are replaced. Others are kept. Keys and tokens are never in a backup.</p>
          {progress && <ProgressBar {...progress} />}
        </Modal>
      )}
    </section>
  )
}

// ---- Appearance -------------------------------------------------------------------

function AppearanceCard() {
  const { settings, updateSettings } = useStore()
  return (
    <section className="card settings-card">
      <h3><Icon name="palette" size={15} /> Appearance</h3>
      <Segmented value={settings.theme} onChange={(theme) => updateSettings({ theme })} options={[['dark', 'Dark'], ['light', 'Light']]} />
    </section>
  )
}
