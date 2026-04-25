import { useStore } from '../store.jsx'

export default function SettingsTab({ showToast }) {
  const { state, setSettings } = useStore()
  const s = state.settings

  const save = () => {
    localStorage.setItem('kss_settings', JSON.stringify(state.settings))
    showToast('Settings saved ✓')
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">API Keys</div>
        <div className="card-sub">Stored locally on your device only — never sent anywhere except the respective APIs.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <div className="field-label">Anthropic API Key</div>
            <input
              className="input"
              type="password"
              placeholder="sk-ant-…"
              value={s.anthropicKey}
              onChange={e => setSettings({ anthropicKey: e.target.value })}
            />
          </div>
          <div className="field">
            <div className="field-label">Google API Key</div>
            <input
              className="input"
              type="password"
              placeholder="AIzaSy…"
              value={s.googleKey || ''}
              onChange={e => setSettings({ googleKey: e.target.value })}
            />
            <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 3 }}>
              Required for Google Drive import · Restrict to Drive API in Google Cloud Console
            </div>
          </div>
          <div className="field">
            <div className="field-label">Meta Access Token</div>
            <input
              className="input"
              type="password"
              placeholder="EAABs…"
              value={s.metaToken}
              onChange={e => setSettings({ metaToken: e.target.value })}
            />
          </div>
          <div className="field">
            <div className="field-label">Instagram Account ID</div>
            <input
              className="input"
              placeholder="17841…"
              value={s.igAccountId}
              onChange={e => setSettings({ igAccountId: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Studio Settings</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <div className="field-label">Instagram Handle</div>
            <input
              className="input"
              placeholder="@kshetejsareenstudios"
              value={s.handle}
              onChange={e => setSettings({ handle: e.target.value })}
            />
          </div>
          <div className="settings-grid">
            <div className="field">
              <div className="field-label">Cloudinary Cloud Name</div>
              <input
                className="input"
                placeholder="dsouvrzlr"
                value={s.cloudName}
                onChange={e => setSettings({ cloudName: e.target.value })}
              />
            </div>
            <div className="field">
              <div className="field-label">Upload Preset</div>
              <input
                className="input"
                placeholder="ml_default"
                value={s.cloudPreset}
                onChange={e => setSettings({ cloudPreset: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      <button className="btn btn-primary" onClick={save}>Save Settings</button>
    </div>
  )
}
