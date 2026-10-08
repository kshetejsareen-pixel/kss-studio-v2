// Promote: turn a picture or a published post into Instagram ads. Claude writes three copy
// variants, the ads go to Meta PAUSED in one ad set so they can be compared, and the
// campaign brief is the manual route through Ads Manager.
import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import Tip from '../components/Tip.jsx'
import { Btn, IconBtn, Field, Segmented, Chips, CopyBtn, Modal, Frame, Empty, useRunner, confirmAction } from '../components/ui.jsx'
import { CropView } from '../components/media.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { useConnections } from '../components/shell.jsx'
import { byId, coverImageId, postLabelAt, isPublished } from '../data/model.js'
import {
  AD_LIMITS, placementInfo, charMeta, ctaLabel, targetingSummary, generateAdVariants, downloadAdImage,
  downloadAllFormats, pushProblem, pushCampaign, campaignBrief, adsManagerUrl,
} from '../lib/ads.js'
import { OBJECTIVES, PLACEMENTS, FUNNEL, CTA_OPTIONS, ADV_PLUS_TIP, INTEREST_GROUPS, INDIA_CITIES } from '../lib/prompts.js'
import { measureRows } from '../lib/insights.js'
import { briefContext } from '../lib/brief.js'
import { metaConfigured } from '../lib/meta.js'
import { formatIst } from '../lib/time.js'

const GENDERS = [['all', 'All'], ['1', 'Men'], ['2', 'Women']]
const PLACEMENT_ASPECT = { feed: '4:5', story: '9:16', reels: '9:16', square: '1:1' }

export default function Promote() {
  const { doc, update, settings, route, toast, go } = useStore()
  const claudeOk = useConnections().claude.tone === 'ok'
  const { busy, run, cancel } = useRunner()
  const [picking, setPicking] = useState(false)
  const [cropping, setCropping] = useState(false)
  const [brief, setBrief] = useState(false)
  const [step, setStep] = useState('')
  const draft = doc.adDraft
  const images = byId(doc.images)
  const image = images.get(draft.imageId) || null
  const boost = draft.mode === 'boost'
  const p = placementInfo(draft.placement)
  const aspect = PLACEMENT_ASPECT[p.id] || '4:5'

  const set = (patch) => update((d) => ({ ...d, adDraft: { ...d.adDraft, ...patch } }))
  const setT = (patch) => update((d) => ({ ...d, adDraft: { ...d.adDraft, targeting: { ...d.adDraft.targeting, ...patch } } }))

  const published = useMemo(() => measureRows(doc).filter((r) => r.id), [doc])
  const boosted = published.find((r) => r.id === draft.boostPostId) || null

  // Arriving from Measure ("Boost") or Review with a post: boost it if it is live,
  // otherwise start a new ad from its cover image.
  const fromPost = route.params?.postId
  useEffect(() => {
    if (!fromPost) return
    const post = doc.posts.find((x) => x.id === fromPost)
    if (!post) return
    if (isPublished(post) && post.publish.igMediaId) set({ mode: 'boost', boostPostId: post.publish.igMediaId })
    else if (coverImageId(post)) set({ mode: 'new', imageId: coverImageId(post), crop: post.design?.exportImageId ? null : post.slides[0]?.crop || null, variants: [] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPost])

  const context = draft.context?.trim() || briefContext(doc)
  const problem = pushProblem({ draft, settings, imageId: draft.imageId, mediaId: draft.boostPostId, variants: draft.variants })
  const metaOk = metaConfigured(settings)

  const generate = async () => {
    const variants = await run('copy', (signal) => generateAdVariants({ imageId: draft.imageId, draft, context, audience: draft.audience, signal }))
    if (variants) set({ variants, selected: 0 })
  }

  const setVariant = (i, patch) => update((d) => ({
    ...d,
    adDraft: { ...d.adDraft, variants: d.adDraft.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) },
  }))
  const removeVariant = (i) => {
    const before = draft.variants
    set({ variants: before.filter((_, j) => j !== i) })
    toast('Variant removed', { action: { label: 'Undo', fn: () => set({ variants: before }) } })
  }

  const push = async () => {
    const n = boost ? 1 : draft.variants.length
    if (!(await confirmAction(`Create ${n} ad${n > 1 ? 's' : ''} in Ads Manager? Everything is created PAUSED — nothing spends until you switch it on there.`, { ok: 'Create paused ads' }))) return
    const res = await run('push', (signal) => pushCampaign({
      draft, variants: draft.variants, imageId: draft.imageId, mediaId: draft.boostPostId, crop: draft.crop, settings, onStep: setStep, signal,
    }))
    setStep('')
    if (!res) return
    update((d) => ({
      ...d,
      adDraft: { ...d.adDraft, resolved: res.resolved },
      ads: [{
        id: res.campaignId,
        at: new Date().toISOString(),
        mode: draft.mode,
        objective: draft.objective,
        placement: draft.placement,
        imageId: boost ? null : draft.imageId,
        mediaId: boost ? draft.boostPostId : null,
        ads: res.ads,
        url: res.url,
        budgetDaily: draft.budgetDaily,
      }, ...d.ads],
    }))
    toast(`Campaign created, paused${res.notes.length ? `. ${res.notes.join(' ')}` : ''}`, {
      kind: 'success',
      duration: 9000,
      action: { label: 'Open Ads Manager', fn: () => window.open(res.url, '_blank', 'noopener') },
    })
  }

  const download = (fn) => run('download', async () => toast(await fn() || 'Downloaded', { kind: 'success' }))

  return (
    <div className="page promote">
      <div className="toolbar">
        <Segmented
          value={draft.mode}
          onChange={(mode) => set({ mode })}
          options={[
            ['new', 'New ad', 'Pick any picture, Claude writes three copy variants to compare'],
            ['boost', 'Boost a post', 'Promote a post that is already on your profile, with its own caption'],
          ]}
        />
        <span className="spacer" />
        <Btn kind="ghost" icon="book" onClick={() => setBrief(true)} tip="Every setting laid out in the order Ads Manager asks for it">Campaign brief</Btn>
      </div>

      {!metaOk && (
        <div className="banner warn">
          <Icon name="warning" size={14} />
          <span>Meta is not connected, so ads can't be created from here. You can still write copy and use the campaign brief in Ads Manager.</span>
          <button type="button" className="link-btn" onClick={() => go('settings')}>Settings</button>
        </div>
      )}

      <div className="promote-body">
        <div className="promote-main">
          <section className="card promote-step">
            <h3><span className="step-num">1</span> Creative</h3>
            {boost ? (
              published.length ? (
                <div className="boost-grid">
                  {published.slice(0, 24).map((r) => (
                    <button key={r.id} type="button" className={`boost-tile ${draft.boostPostId === r.id ? 'on' : ''}`} onClick={() => set({ boostPostId: r.id })} aria-label={r.label || 'Published post'}>
                      {r.imageId && images.get(r.imageId) ? <Frame image={images.get(r.imageId)} aspect="4:5" /> : r.thumbUrl ? <img src={r.thumbUrl} alt="" loading="lazy" /> : <span className="frame loading" />}
                      {r.label && <span className="boost-label">{r.label}</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="field-hint">No published posts yet. Sync insights in Measure to load your profile, or publish from Schedule.</p>
              )
            ) : (
              <div className="creative-row">
                <button type="button" className="creative-pick" onClick={() => setPicking(true)}>
                  {image ? <Frame image={image} crop={draft.crop} aspect={aspect} /> : <span className="creative-empty"><Icon name="image" size={22} /><span>Choose a picture</span></span>}
                </button>
                <div className="creative-actions">
                  <Field label="Placement" group>
                    <Segmented value={draft.placement} onChange={(placement) => set({ placement })} options={PLACEMENTS.map((x) => [x.id, x.label, x.tip])} size="sm" />
                  </Field>
                  <div className="btn-row">
                    <Btn size="sm" kind="ghost" icon="image" onClick={() => setPicking(true)}>{image ? 'Change' : 'Choose'}</Btn>
                    <Btn size="sm" kind="ghost" icon="zoomIn" disabled={!image} onClick={() => setCropping(true)}>Crop</Btn>
                    <Btn size="sm" kind="ghost" icon="download" disabled={!image} busy={busy === 'download'} onClick={() => download(() => downloadAdImage(draft.imageId, draft.placement, draft.crop))} tip={`${p.w}×${p.h} JPG`}>Download</Btn>
                    <Btn size="sm" kind="ghost" icon="layers" disabled={!image} onClick={() => download(async () => { await downloadAllFormats(draft.imageId, draft.crop); return 'Downloaded feed, story and reel sizes' })} tip="Feed 4:5 plus 9:16 for Stories and Reels">All sizes</Btn>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="card promote-step">
            <h3><span className="step-num">2</span> Goal</h3>
            <Field label="Objective" group>
              <Segmented value={draft.objective} onChange={(objective) => set({ objective })} options={OBJECTIVES.filter((o) => !o.disabled).map((o) => [o.id, o.label, o.tip])} />
            </Field>
            <Field label="Audience temperature" group>
              <Segmented value={draft.funnel} onChange={(funnel) => set({ funnel })} options={FUNNEL.map((f) => [f.id, `${f.label} · ${f.desc.split(' — ')[0]}`, f.tip])} size="sm" />
            </Field>
          </section>

          <section className="card promote-step">
            <h3><span className="step-num">3</span> Audience</h3>
            <label className="switch-row">
              <span className="switch"><input type="checkbox" checked={!!draft.advPlus} onChange={(e) => set({ advPlus: e.target.checked })} /><span /></span>
              <span>Advantage+ audience</span>
              <Tip text={ADV_PLUS_TIP}><span className="tip-icon"><Icon name="info" size={13} /></span></Tip>
            </label>
            {draft.advPlus && <p className="field-hint">Meta finds the audience from your creative. Location stays fixed; age becomes a suggestion (minimum up to 25, maximum 65) and interests are left out.</p>}
            <div className="field-row">
              <Field label="Age from">
                <input type="number" min={18} max={65} value={draft.targeting.ageMin} onChange={(e) => setT({ ageMin: Number(e.target.value) })} />
              </Field>
              <Field label="to">
                <input type="number" min={18} max={65} value={draft.targeting.ageMax} onChange={(e) => setT({ ageMax: Number(e.target.value) })} />
              </Field>
              <Field label="Gender" group>
                <Segmented
                  value={draft.targeting.genders?.length ? String(draft.targeting.genders[0]) : 'all'}
                  onChange={(g) => setT({ genders: g === 'all' ? [] : [Number(g)] })}
                  options={GENDERS}
                  size="sm"
                />
              </Field>
            </div>
            <Field label="Cities" hint="None selected means all of India." group>
              <Chips options={unique([...INDIA_CITIES, ...draft.targeting.cities])} value={draft.targeting.cities} onChange={(cities) => setT({ cities })} />
              <AddChip placeholder="Add a city" onAdd={(c) => setT({ cities: unique([...draft.targeting.cities, c]) })} />
            </Field>
            {!draft.advPlus && (
              <Field label="Interests" hint="Matched to Meta's interest list when the ads are created." group>
                {INTEREST_GROUPS.map((g) => (
                  <div key={g.group} className="chip-group">
                    <span className="mute">{g.group}</span>
                    <Chips options={g.items} value={draft.targeting.interests} onChange={(interests) => setT({ interests })} />
                  </div>
                ))}
                <Chips options={draft.targeting.interests.filter((i) => !INTEREST_GROUPS.some((g) => g.items.includes(i)))} value={draft.targeting.interests} onChange={(interests) => setT({ interests })} />
                <AddChip placeholder="Add an interest" onAdd={(i) => setT({ interests: unique([...draft.targeting.interests, i]) })} />
              </Field>
            )}
            <Field label="Who is this for?" hint="Plain words for Claude: the client, their budget, what they care about.">
              <textarea rows={2} value={draft.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="e.g. Founders of D2C fashion labels in Mumbai launching a new collection" />
            </Field>
          </section>

          {!boost && (
            <section className="card promote-step">
              <h3><span className="step-num">4</span> Copy</h3>
              <Field label="What the ad is about" hint="Left empty, Claude uses your brief and learnings.">
                <textarea rows={2} value={draft.context} onChange={(e) => set({ context: e.target.value })} placeholder="The offer, the shoot, the reason to act now" />
              </Field>
              <div className="btn-row">
                {busy === 'copy'
                  ? <Btn kind="ghost" icon="x" onClick={cancel}>Cancel</Btn>
                  : <Btn kind="primary" icon="sparkle" disabled={!claudeOk || !image} onClick={generate} tip={!claudeOk ? 'Connect Claude in Settings' : !image ? 'Choose a picture first' : 'Three variants with different angles'}>{draft.variants.length ? 'Write new variants' : 'Write copy'}</Btn>}
                {busy === 'copy' && <span className="status-line"><Icon name="sparkle" size={13} /> Claude is looking at the picture…</span>}
              </div>
              {draft.variants.length > 0 && (
                <div className="variant-list">
                  {draft.variants.map((v, i) => (
                    <Variant key={i} v={v} index={i} onChange={(patch) => setVariant(i, patch)} onRemove={() => removeVariant(i)} />
                  ))}
                  {draft.variants.length > 1 && <p className="field-hint">All {draft.variants.length} variants go into one ad set, so Meta splits delivery and shows you which one wins.</p>}
                </div>
              )}
            </section>
          )}

          <section className="card promote-step">
            <h3><span className="step-num">{boost ? 4 : 5}</span> Budget</h3>
            <div className="field-row">
              <Field label="Daily budget (₹)">
                <input type="number" min={100} step={100} value={draft.budgetDaily} onChange={(e) => set({ budgetDaily: Number(e.target.value) })} />
              </Field>
              <Field label="Runs" group>
                <Segmented value={draft.ongoing ? 'on' : 'dates'} onChange={(v) => set({ ongoing: v === 'on' })} options={[['on', 'Until stopped'], ['dates', 'Between dates']]} size="sm" />
              </Field>
            </div>
            {!draft.ongoing && (
              <div className="field-row">
                <Field label="Start"><input type="date" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
                <Field label="End"><input type="date" value={draft.endDate} min={draft.startDate || undefined} onChange={(e) => set({ endDate: e.target.value })} /></Field>
              </div>
            )}
          </section>
        </div>

        <aside className="promote-side">
          <div className="card ad-preview">
            <div className="ad-preview-head">
              <span className="avatar"><Icon name="user" size={13} /></span>
              <strong>{settings.handle || 'yourstudio'}</strong>
              <span className="mute">Sponsored</span>
            </div>
            {boost
              ? boosted?.imageId && images.get(boosted.imageId) ? <Frame image={images.get(boosted.imageId)} aspect="4:5" /> : boosted?.thumbUrl ? <img className="ad-preview-img" src={boosted.thumbUrl} alt="" /> : <div className="frame loading" style={{ aspectRatio: 0.8 }} />
              : <Frame image={image} crop={draft.crop} aspect={aspect} />}
            {!boost && draft.variants[draft.selected || 0] && (
              <div className="ad-preview-copy">
                <div className="ad-cta"><span>{ctaLabel(draft.variants[draft.selected || 0].cta)}</span><Icon name="right" size={13} /></div>
                <p>{draft.variants[draft.selected || 0].primaryText}</p>
              </div>
            )}
            {!boost && draft.variants.length > 1 && (
              <Segmented value={draft.selected || 0} onChange={(selected) => set({ selected })} options={draft.variants.map((v, i) => [i, `Ad ${i + 1}`, v.angle])} size="sm" />
            )}
          </div>

          <div className="card">
            <p className="summary-line">{targetingSummary(draft.targeting, draft.budgetDaily)}</p>
            {problem
              ? <p className="field-hint warn"><Icon name="warning" size={13} /> {problem}</p>
              : <p className="field-hint"><Icon name="check" size={13} /> Ready. Ads are created paused.</p>}
            {busy === 'push'
              ? <><p className="status-line"><Icon name="megaphone" size={13} /> {step || 'Working…'}</p><Btn kind="ghost" onClick={cancel}>Cancel</Btn></>
              : <Btn kind="primary" icon="megaphone" disabled={!!problem} onClick={push}>Create in Ads Manager</Btn>}
          </div>

          {doc.ads.length > 0 && (
            <div className="card">
              <div className="side-head"><strong>Created</strong><span className="mute">{doc.ads.length}</span></div>
              <ul className="ad-history">
                {doc.ads.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    <span>{OBJECTIVES.find((o) => o.id === a.objective)?.label || 'Campaign'} · {a.mode === 'boost' ? 'Boost' : `${a.ads?.length || 1} ad${a.ads?.length > 1 ? 's' : ''}`}</span>
                    <span className="mute">{formatIst(a.at, { day: 'numeric', month: 'short' })}</span>
                    <a className="link-btn" href={a.url || adsManagerUrl(settings.adAccountId, a.id)} target="_blank" rel="noreferrer"><Icon name="external" size={12} /></a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {picking && <ImagePicker onClose={() => setPicking(false)} onPick={(id, crop) => { set({ imageId: id, crop, variants: [] }); setPicking(false) }} />}
      {cropping && image && (
        <Modal title={`Crop for ${p.label}`} onClose={() => setCropping(false)} footer={<Btn kind="primary" onClick={() => setCropping(false)}>Done</Btn>} width={460}>
          <CropView image={image} crop={draft.crop} aspect={aspect} onChange={(crop) => set({ crop })} />
        </Modal>
      )}
      {brief && <BriefModal onClose={() => setBrief(false)} onDownload={() => download(() => downloadAdImage(draft.imageId, draft.placement, draft.crop))} />}
    </div>
  )
}

const unique = (list) => [...new Set(list.map((x) => String(x).trim()).filter(Boolean))]

function AddChip({ placeholder, onAdd }) {
  const [text, setText] = useState('')
  const add = () => {
    if (text.trim()) onAdd(text.trim())
    setText('')
  }
  return (
    <div className="add-chip">
      <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
      <IconBtn icon="plus" label="Add" size={13} onClick={add} />
    </div>
  )
}

function Counter({ text, limit }) {
  const m = charMeta(text, limit)
  return <span className={`counter ${m.tone}`}>{m.len}/{limit}</span>
}

function Variant({ v, index, onChange, onRemove }) {
  return (
    <article className="variant">
      <div className="variant-head">
        <strong>Ad {index + 1}</strong>
        <input className="variant-angle" value={v.angle} onChange={(e) => onChange({ angle: e.target.value })} aria-label="Angle" />
        <span className="spacer" />
        <CopyBtn text={[v.primaryText, v.headline, v.description].join('\n\n')} />
        <IconBtn icon="trash" label="Remove variant" size={13} onClick={onRemove} />
      </div>
      <Field label="Primary text" counter={<Counter text={v.primaryText} limit={AD_LIMITS.primaryText} />} hint="Instagram shows about 125 characters before “more”.">
        <textarea rows={3} value={v.primaryText} onChange={(e) => onChange({ primaryText: e.target.value })} />
      </Field>
      <div className="field-row">
        <Field label="Headline" counter={<Counter text={v.headline} limit={AD_LIMITS.headline} />}>
          <input value={v.headline} onChange={(e) => onChange({ headline: e.target.value })} />
        </Field>
        <Field label="Description" counter={<Counter text={v.description} limit={AD_LIMITS.description} />}>
          <input value={v.description} onChange={(e) => onChange({ description: e.target.value })} />
        </Field>
        <Field label="Button">
          <select value={v.cta} onChange={(e) => onChange({ cta: e.target.value })}>
            {CTA_OPTIONS.map((c) => <option key={c} value={c}>{ctaLabel(c)}</option>)}
          </select>
        </Field>
      </div>
    </article>
  )
}

function ImagePicker({ onClose, onPick }) {
  const { doc } = useStore()
  const images = byId(doc.images)
  const [tab, setTab] = useState('posts')
  const posts = doc.posts
    .map((p, i) => ({ p, label: postLabelAt(doc.posts, i), image: images.get(coverImageId(p)) }))
    .filter((r) => r.image)
  const library = doc.images.filter((img) => img.cull !== 'reject')
  return (
    <Modal title="Choose the ad picture" onClose={onClose} width={760} className="picker-modal">
      <Segmented value={tab} onChange={setTab} options={[['posts', `From posts (${posts.length})`], ['library', `Library (${library.length})`]]} size="sm" />
      {tab === 'posts' && !posts.length && <Empty icon="grid" title="No posts with pictures yet" />}
      <div className="picker-grid">
        {tab === 'posts'
          ? posts.map((r) => (
            <button key={r.p.id} type="button" onClick={() => onPick(r.image.id, r.p.design?.exportImageId ? null : r.p.slides[0]?.crop || null)}>
              <Frame image={r.image} crop={r.p.design?.exportImageId ? null : r.p.slides[0]?.crop} aspect="4:5" />
              <span className="picker-label">{r.label}</span>
            </button>
          ))
          : library.map((img) => (
            <button key={img.id} type="button" onClick={() => onPick(img.id, null)}>
              <Frame image={img} aspect="4:5" />
            </button>
          ))}
      </div>
    </Modal>
  )
}

function BriefModal({ onClose, onDownload }) {
  const { doc, settings } = useStore()
  const b = campaignBrief(doc.adDraft, settings)
  return (
    <Modal title={b.title} onClose={onClose} width={680} footer={<Btn kind="ghost" onClick={onClose}>Close</Btn>}>
      <p className="field-hint">{b.subtitle}</p>
      {doc.adDraft.mode !== 'boost' && (
        <div className="btn-row">
          <Btn size="sm" kind="ghost" icon="download" disabled={!doc.adDraft.imageId} onClick={onDownload}>Download image ({b.image})</Btn>
          <a className="btn ghost sm" href={adsManagerUrl(settings.adAccountId)} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Ads Manager</a>
        </div>
      )}
      {b.sections.map((s) => (
        <section key={s.title} className="brief-section">
          <div className="side-head">
            <strong>{s.title}</strong>
            {s.copy && <CopyBtn text={s.copy} label="Copy all" />}
          </div>
          <dl className="brief-rows">
            {s.rows.map(([label, value, muted]) => (
              <div key={label} className={muted ? 'mute' : ''}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <ul className="hint-list">{b.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </Modal>
  )
}
