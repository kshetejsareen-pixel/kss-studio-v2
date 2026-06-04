import { useState } from 'react'
import { useStore } from '../store.jsx'

const REQUIRED_SCOPES = ['ads_management', 'ads_read', 'instagram_basic', 'pages_read_engagement']

export default function SettingsTab({ showToast }) {
  const { state, setSettings } = useStore()
  const s = state.settings

  const [metaCheck, setMetaCheck]   = useState(null)  // null | 'loading' | { ok, scopes, expires, accountName, currency, error }

  const save = () => {
    localStorage.setItem('kss_settings', JSON.stringify(state.settings))
    showToast('Settings saved ✓')
  }

  const checkMeta = async () => {
    if (!s.metaToken) { showToast('Add Meta token first'); return }
    setMetaCheck('loading')
    try {
      const result = {}

      // 1 — Token debug: scopes + expiry
      const dbRes  = await fetch(`https://graph.facebook.com/v20.0/debug_token?input_token=${s.metaToken}&access_token=${s.metaToken}`)
      const dbData = await dbRes.json()
      if (dbData.error) throw new Error(dbData.error.message)
      const d = dbData.data || {}
      result.scopes  = d.scopes || []
      result.expires = d.expires_at ? new Date(d.expires_at * 1000).toLocaleDateString() : 'never (system token)'
      result.tokenType = d.type || 'unknown'
      result.ok = !d.is_valid === false

      // 2 — Ad account: currency + name
      if (s.adAccountId) {
        const accId  = s.adAccountId.replace(/^act_/, '')
        const acRes  = await fetch(`https://graph.facebook.com/v20.0/act_${accId}?fields=name,currency,account_status&access_token=${s.metaToken}`)
        const acData = await acRes.json()
        if (!acData.error) {
          result.accountName = acData.name
          result.currency    = acData.currency
          result.accountStatus = acData.account_status === 1 ? 'Active' : `Status ${acData.account_status}`
        }
      }

      // 3 — Custom audiences count
      if (s.adAccountId) {
        const accId  = s.adAccountId.replace(/^act_/, '')
        const caRes  = await fetch(`https://graph.facebook.com/v20.0/act_${accId}/customaudiences?fields=name,subtype&limit=5&access_token=${s.metaToken}`)
        const caData = await caRes.json()
        if (!caData.error) result.customAudiences = caData.data || []
      }

      setMetaCheck(result)
    } catch(e) {
      setMetaCheck({ error: e.message })
    }
  }

  const scopeStatus = (scope) => {
    if (!metaCheck || metaCheck === 'loading' || metaCheck.error) return null
    return (metaCheck.scopes || []).includes(scope)
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">API Keys</div>
        <div className="card-sub">Stored locally on your device only — never sent anywhere except the respective APIs.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <div className="field-label">Anthropic API Key</div>
            <input className="input" type="password" placeholder="sk-ant-…"
              value={s.anthropicKey} onChange={e => setSettings({ anthropicKey: e.target.value })} />
          </div>
          <div className="field">
            <div className="field-label">Google API Key</div>
            <input className="input" type="password" placeholder="AIzaSy…"
              value={s.googleKey || ''} onChange={e => setSettings({ googleKey: e.target.value })} />
            <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 3 }}>
              Required for Google Drive import · Restrict to Drive API in Google Cloud Console
            </div>
          </div>

          {/* ── META SECTION ── */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--silver)', fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>Meta / Instagram</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <div className="field-label">Access Token</div>
                <input className="input" type="password" placeholder="EAABs…"
                  value={s.metaToken} onChange={e => { setSettings({ metaToken: e.target.value }); setMetaCheck(null) }} />
              </div>
              <div className="field">
                <div className="field-label">Instagram Account ID</div>
                <input className="input" placeholder="17841…"
                  value={s.igAccountId} onChange={e => setSettings({ igAccountId: e.target.value })} />
              </div>
              <div className="field">
                <div className="field-label">Ad Account ID</div>
                <input className="input" placeholder="act_XXXXXXXXXX"
                  value={s.adAccountId} onChange={e => { setSettings({ adAccountId: e.target.value }); setMetaCheck(null) }} />
              </div>

              {/* Check permissions button */}
              <button className="btn btn-ghost btn-sm" onClick={checkMeta} disabled={metaCheck === 'loading'} style={{ alignSelf: 'flex-start' }}>
                {metaCheck === 'loading' ? <><span className="spin" /> Checking…</> : '⟳ Check Meta Connection'}
              </button>

              {/* Results */}
              {metaCheck && metaCheck !== 'loading' && (
                <div style={{ background: 'var(--surface)', border: `1px solid ${metaCheck.error ? 'rgba(200,60,60,.4)' : 'var(--border)'}`, borderRadius: 4, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {metaCheck.error ? (
                    <div style={{ fontSize: 11, color: 'rgba(220,80,80,.9)', fontFamily: 'var(--font-mono)' }}>
                      ✕ {metaCheck.error}
                    </div>
                  ) : (
                    <>
                      {/* Token info */}
                      <div style={{ display: 'flex', gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 2 }}>Token type</div>
                          <div style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{metaCheck.tokenType}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 2 }}>Expires</div>
                          <div style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{metaCheck.expires}</div>
                        </div>
                        {metaCheck.currency && (
                          <div>
                            <div style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 2 }}>Currency</div>
                            <div style={{ fontSize: 11, color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>{metaCheck.currency}</div>
                          </div>
                        )}
                      </div>

                      {metaCheck.accountName && (
                        <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                          Ad Account: <span style={{ color: 'var(--silver)' }}>{metaCheck.accountName}</span>
                          <span style={{ marginLeft: 8, fontSize: 9, color: 'rgba(80,200,80,.7)' }}>{metaCheck.accountStatus}</span>
                        </div>
                      )}

                      {/* Scope grid */}
                      <div>
                        <div style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>Permissions needed for targeting</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                          {REQUIRED_SCOPES.map(scope => {
                            const has = scopeStatus(scope)
                            return (
                              <div key={scope} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: has ? 'rgba(80,200,80,.06)' : 'rgba(200,80,80,.06)', border: `1px solid ${has ? 'rgba(80,200,80,.2)' : 'rgba(200,80,80,.2)'}`, borderRadius: 3 }}>
                                <span style={{ fontSize: 11, color: has ? 'rgba(80,200,80,.9)' : 'rgba(220,80,80,.8)' }}>{has ? '✓' : '✕'}</span>
                                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: has ? 'var(--text2)' : 'rgba(220,120,120,.8)' }}>{scope}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* All scopes */}
                      <div>
                        <div style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4 }}>All scopes on this token</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {(metaCheck.scopes || []).map(sc => (
                            <span key={sc} style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text2)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 2, padding: '2px 6px' }}>{sc}</span>
                          ))}
                        </div>
                      </div>

                      {/* Custom audiences */}
                      {metaCheck.customAudiences?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 8, color: 'var(--mute)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 4 }}>Custom audiences found ({metaCheck.customAudiences.length} shown)</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {metaCheck.customAudiences.map(a => (
                              <div key={a.id} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>
                                <span style={{ color: 'var(--silver)' }}>{a.name}</span>
                                <span style={{ color: 'var(--mute)', marginLeft: 6 }}>{a.subtype}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Missing scope warning */}
                      {REQUIRED_SCOPES.some(sc => !scopeStatus(sc)) && (
                        <div style={{ fontSize: 9, color: 'rgba(220,160,0,.85)', fontFamily: 'var(--font-mono)', lineHeight: 1.6, padding: '6px 8px', background: 'rgba(220,160,0,.06)', border: '1px solid rgba(220,160,0,.2)', borderRadius: 3 }}>
                          Missing scopes will limit targeting features. Re-generate your token in Meta Business Manager with these permissions enabled.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Studio Settings</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <div className="field-label">Instagram Handle</div>
            <input className="input" placeholder="@kshetejsareenstudios"
              value={s.handle} onChange={e => setSettings({ handle: e.target.value })} />
          </div>
          <div className="settings-grid">
            <div className="field">
              <div className="field-label">Cloudinary Cloud Name</div>
              <input className="input" placeholder="dsouvrzlr"
                value={s.cloudName} onChange={e => setSettings({ cloudName: e.target.value })} />
            </div>
            <div className="field">
              <div className="field-label">Upload Preset</div>
              <input className="input" placeholder="ml_default"
                value={s.cloudPreset} onChange={e => setSettings({ cloudPreset: e.target.value })} />
            </div>
          </div>
        </div>
      </div>

      <button className="btn btn-primary" onClick={save}>Save Settings</button>
    </div>
  )
}
