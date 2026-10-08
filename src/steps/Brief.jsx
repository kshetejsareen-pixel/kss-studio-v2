// Step 1: who the client is, who they're talking to, and how the grid should feel.
// Everything here becomes prompt context for planning, captions and designs.
import { useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Btn, IconBtn, Field, Chips, Meter, Modal, Empty, Frame, CopyBtn, confirmAction, useRunner } from '../components/ui.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { emptyKit, isPhoto, MAX_KITS, KIT_COLORS, byId } from '../data/model.js'
import { briefCompleteness } from '../lib/brief.js'
import { draftThemes, research, analyseReferenceScreenshot, analyseLayoutUrl, shotList } from '../lib/studio.js'
import { INDIA_CITIES, INTEREST_GROUPS, SHOTLIST_SECTIONS } from '../lib/prompts.js'
import { uid } from '../lib/ids.js'

const GENDERS = ['Women', 'Men', 'All genders']
const now = () => new Date().toISOString()

export default function Brief() {
  const { doc, update } = useStore()
  const b = doc.brief
  const setBrief = (patch) => update((d) => ({ ...d, brief: { ...d.brief, ...(typeof patch === 'function' ? patch(d.brief) : patch), updatedAt: now() } }))
  const setAudience = (patch) => setBrief((br) => ({ audience: { ...br.audience, ...patch } }))
  const { score, missing } = briefCompleteness(b)

  return (
    <div className="step-split">
      <div className="step-main">
        <section className="card" id="brief-basics">
          <header className="card-head">
            <h2><span className="sec-num">1</span>The client</h2>
          </header>
          <div className="form-grid">
            <Field label="Client or brand"><input value={b.client} onChange={(e) => setBrief({ client: e.target.value })} placeholder="e.g. Aman Hotels" /></Field>
            <Field label="What they sell"><input value={b.offer} onChange={(e) => setBrief({ offer: e.target.value })} placeholder="Product, service or experience" /></Field>
            <Field label="Goal for this grid" className="span2"><input value={b.goal} onChange={(e) => setBrief({ goal: e.target.value })} placeholder="e.g. Book more pre-wedding shoots from Delhi NCR" /></Field>
            <Field label="Voice" hint="How the brand sounds — three words is enough." className="span2"><input value={b.voice} onChange={(e) => setBrief({ voice: e.target.value })} placeholder="Quiet, assured, crafted" /></Field>
            <Field label="Do"><textarea rows={2} value={b.dos} onChange={(e) => setBrief({ dos: e.target.value })} /></Field>
            <Field label="Don’t"><textarea rows={2} value={b.donts} onChange={(e) => setBrief({ donts: e.target.value })} /></Field>
            <Field label="Call to action"><input value={b.cta} onChange={(e) => setBrief({ cta: e.target.value })} placeholder="DM to book · link in bio" /></Field>
            <Field label="Competitors or references"><input value={b.competitors} onChange={(e) => setBrief({ competitors: e.target.value })} placeholder="@handles you admire or compete with" /></Field>
          </div>
        </section>

        <section className="card">
          <header className="card-head">
            <h2><span className="sec-num">2</span>Audience</h2>
            <span className="field-hint">Used by captions, plans and Promote targeting.</span>
          </header>
          <div className="form-grid">
            <Field label="Who they are" className="span2"><textarea rows={2} value={b.target} onChange={(e) => setBrief({ target: e.target.value })} placeholder="e.g. Founders of boutique hotels who care how their space is seen" /></Field>
            <Field label="Age" group>
              <div className="row">
                <input type="number" min={13} max={65} value={b.audience.ageMin} onChange={(e) => setAudience({ ageMin: Number(e.target.value) || 18 })} aria-label="Minimum age" />
                <span className="mute">to</span>
                <input type="number" min={13} max={65} value={b.audience.ageMax} onChange={(e) => setAudience({ ageMax: Number(e.target.value) || 65 })} aria-label="Maximum age" />
              </div>
            </Field>
            <Field label="Gender" group><Chips options={GENDERS} value={b.audience.genders} onChange={(genders) => setAudience({ genders })} /></Field>
            <Field label="Cities" className="span2" group><Chips options={INDIA_CITIES} value={b.audience.locations} onChange={(locations) => setAudience({ locations })} /></Field>
            <div className="span2 interest-groups">
              <span className="label">Interests</span>
              {INTEREST_GROUPS.map((g) => (
                <div key={g.group} className="interest-group">
                  <span className="field-hint">{g.group}</span>
                  <Chips options={g.items} value={b.audience.interests} onChange={(interests) => setAudience({ interests })} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <Pillars brief={b} setBrief={setBrief} />
        <Cadence brief={b} setBrief={setBrief} />
        <ThemeKits />
        <ShotList />
      </div>

      <aside className="step-side">
        <section className="card">
          <header className="card-head"><h3>Brief</h3><span className="big-num">{score}%</span></header>
          <Meter value={score} />
          {missing.length > 0 ? (
            <ul className="todo-list">
              {missing.map((m) => <li key={m.key}><Icon name="minus" size={12} />{m.label}</li>)}
            </ul>
          ) : <p className="field-hint">Complete. Every plan and caption now uses it.</p>}
          <Versions />
        </section>
        <Research />
        <References />
        <Learnings />
      </aside>
    </div>
  )
}

// ---- Pillars and cadence ------------------------------------------------------------------

function Pillars({ brief, setBrief }) {
  const list = brief.pillars
  const set = (i, patch) => setBrief({ pillars: list.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const total = list.reduce((s, p) => s + (Number(p.share) || 0), 0)
  return (
    <section className="card">
      <header className="card-head">
        <h2><span className="sec-num">3</span>Content pillars</h2>
        {list.length > 0 && <span className={`field-hint ${total !== 100 ? 'warn-text' : ''}`}>{total}% of posts</span>}
      </header>
      {list.map((p, i) => (
        <div className="pillar-row" key={p.id || i}>
          <input value={p.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Pillar" aria-label="Pillar name" />
          <input value={p.desc || ''} onChange={(e) => set(i, { desc: e.target.value })} placeholder="What goes in it" aria-label="Pillar description" />
          <div className="pct-input"><input type="number" min={0} max={100} value={p.share || ''} onChange={(e) => set(i, { share: Number(e.target.value) || 0 })} aria-label="Share of posts" /><span>%</span></div>
          <IconBtn icon="x" label="Remove pillar" onClick={() => setBrief({ pillars: list.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <Btn size="sm" kind="ghost" icon="plus" onClick={() => setBrief({ pillars: [...list, { id: uid('pl'), name: '', desc: '', share: 0 }] })}>Add pillar</Btn>
    </section>
  )
}

function Cadence({ brief, setBrief }) {
  const c = brief.cadence
  const setMix = (k, v) => setBrief({ cadence: { ...c, mix: { ...c.mix, [k]: Number(v) || 0 } } })
  const dates = brief.keyDates
  const setDate = (i, patch) => setBrief({ keyDates: dates.map((d, j) => (j === i ? { ...d, ...patch } : d)) })
  return (
    <section className="card">
      <header className="card-head"><h2><span className="sec-num">4</span>Cadence and key dates</h2></header>
      <div className="form-grid">
        <Field label="Posts per week"><input type="number" min={1} max={14} value={c.perWeek} onChange={(e) => setBrief({ cadence: { ...c, perWeek: Number(e.target.value) || 1 } })} /></Field>
        <Field label="Format mix (%)" group>
          <div className="row">
            {['single', 'carousel', 'reel'].map((k) => (
              <label key={k} className="mini-input"><span>{k}</span><input type="number" min={0} max={100} value={c.mix[k] ?? 0} onChange={(e) => setMix(k, e.target.value)} /></label>
            ))}
          </div>
        </Field>
      </div>
      <span className="label">Key dates</span>
      {dates.map((d, i) => (
        <div className="row" key={d.id || i}>
          <input type="date" value={d.date || ''} onChange={(e) => setDate(i, { date: e.target.value })} aria-label="Date" />
          <input value={d.label || ''} onChange={(e) => setDate(i, { label: e.target.value })} placeholder="Launch, festival, sale…" aria-label="What happens" />
          <IconBtn icon="x" label="Remove date" onClick={() => setBrief({ keyDates: dates.filter((_, j) => j !== i) })} />
        </div>
      ))}
      <Btn size="sm" kind="ghost" icon="plus" onClick={() => setBrief({ keyDates: [...dates, { id: uid('kd'), date: '', label: '' }] })}>Add date</Btn>
    </section>
  )
}

// ---- Theme kits ----------------------------------------------------------------------------

const KIT_FIELDS = [
  ['intent', 'Intent', 'What should the viewer feel or understand?'],
  ['mood', 'Mood', 'One or two words'],
  ['light', 'Light', 'Soft north light, hard noon sun…'],
  ['composition', 'Composition', 'Framing rules'],
  ['subjects', 'Subjects', 'What appears in frame'],
  ['devices', 'Visual devices', 'Recurring tricks — reflections, negative space left…'],
  ['type', 'Type', 'Typography feel for graphics'],
  ['captionTone', 'Caption tone', 'How captions in this theme sound'],
  ['gridPattern', 'Grid pattern', 'Every third tile, diagonal, top row…'],
  ['do', 'Do', ''],
  ['dont', 'Don’t', ''],
  ['notThis', 'Not this', 'What this theme is NOT'],
  ['success', 'Success looks like', 'A metric or reaction'],
]

function ThemeKits() {
  const { doc, update, toast, thumbs } = useStore()
  const { busy, run } = useRunner()
  const [open, setOpen] = useState(null)
  const kits = doc.themes
  const images = byId(doc.images)
  const setKits = (fn) => update((d) => ({ ...d, themes: fn(d.themes) }))

  const draft = () => run('draft', async (signal) => {
    const photos = doc.images.filter(isPhoto)
    if (!photos.length) throw new Error('Import images first')
    const pool = doc.shortlist.length ? doc.shortlist : photos.filter((i) => !i.setAside && i.cull !== 'reject').map((i) => i.id)
    const step = Math.max(1, Math.floor(pool.length / 16))
    const ids = pool.filter((_, i) => i % step === 0).slice(0, 16)
    const drafted = await draftThemes(doc, ids, { signal })
    if (!drafted.length) throw new Error('Claude didn’t find distinct themes. Add more varied photos.')
    update((d) => {
      const room = Math.max(0, MAX_KITS - d.themes.length)
      const added = drafted.slice(0, room)
      const owner = new Map()
      added.forEach((k) => k.refImageIds.forEach((id) => owner.set(id, k.id)))
      return {
        ...d,
        themes: [...d.themes, ...added],
        images: d.images.map((i) => (owner.has(i.id) && !i.themeId ? { ...i, themeId: owner.get(i.id) } : i)),
      }
    })
    toast(`${drafted.length} themes drafted from ${ids.length} photos — edit them to taste.`, { kind: 'success' })
  })

  const add = () => {
    if (kits.length >= MAX_KITS) return
    const k = emptyKit({}, kits)
    setKits((ks) => [...ks, k])
    setOpen(k.id)
  }
  const remove = (id) => {
    if (!confirmAction('Delete this theme? Posts and photos using it keep their content but lose the tag.')) return
    update((d) => ({
      ...d,
      themes: d.themes.filter((k) => k.id !== id),
      images: d.images.map((i) => (i.themeId === id ? { ...i, themeId: null } : i)),
      posts: d.posts.map((p) => (p.themeId === id ? { ...p, themeId: null } : p)),
    }))
  }
  const editing = kits.find((k) => k.id === open)
  const usedBy = (id) => doc.images.filter((i) => i.themeId === id).length

  return (
    <section className="card">
      <header className="card-head">
        <h2><span className="sec-num">5</span>Themes</h2>
        <div className="row">
          <Btn size="sm" icon="sparkle" busy={busy === 'draft'} onClick={draft} tip="Claude looks at your shortlist (or a spread of your library) and groups it into 2–4 themes">Draft from images</Btn>
          <Btn size="sm" kind="ghost" icon="plus" onClick={add} disabled={kits.length >= MAX_KITS}>Theme</Btn>
        </div>
      </header>
      <p className="field-hint">A theme is a repeatable look: palette, light, composition and caption tone. Tag photos with themes in the Library, then the plan keeps each theme consistent across the grid.</p>
      {kits.length === 0 ? (
        <Empty icon="palette" title="No themes yet">Draft them from your photos, or add one and describe it.</Empty>
      ) : (
        <div className="kit-grid">
          {kits.map((k) => (
            <button key={k.id} type="button" className="kit-card" onClick={() => setOpen(k.id)} style={{ '--kit': k.color }}>
              <div className="kit-refs">
                {(k.refImageIds || []).slice(0, 4).map((id) => (
                  <span key={id} className="kit-ref" style={{ backgroundImage: thumbs[id] ? `url("${thumbs[id]}")` : undefined }} />
                ))}
                {!(k.refImageIds || []).length && <span className="kit-ref empty"><Icon name="image" size={14} /></span>}
              </div>
              <div className="kit-meta">
                <span className="kit-name"><span className="swatch" style={{ background: k.color }} />{k.name}</span>
                <span className="kit-intent">{k.intent || k.mood || 'Describe this theme'}</span>
                <span className="kit-palette">{(k.palette || []).map((c) => <span key={c} style={{ background: c }} />)}</span>
                <span className="field-hint">{usedBy(k.id)} photos</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {editing && (
        <Modal title={editing.name || 'Theme'} onClose={() => setOpen(null)} width={720}
          footer={<><Btn kind="danger" icon="trash" onClick={() => { remove(editing.id); setOpen(null) }}>Delete</Btn><span className="grow" /><Btn kind="primary" onClick={() => setOpen(null)}>Done</Btn></>}>
          <KitEditor kit={editing} images={images} onChange={(patch) => setKits((ks) => ks.map((k) => (k.id === editing.id ? { ...k, ...patch } : k)))} />
        </Modal>
      )}
    </section>
  )
}

function KitEditor({ kit, images, onChange }) {
  const [hex, setHex] = useState('')
  const addColor = () => {
    const v = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`
    if (/^#[0-9a-f]{6}$/i.test(v) && (kit.palette || []).length < 6) onChange({ palette: [...(kit.palette || []), v.toUpperCase()] })
    setHex('')
  }
  return (
    <div className="kit-editor">
      <div className="form-grid">
        <Field label="Name"><input value={kit.name} onChange={(e) => onChange({ name: e.target.value })} /></Field>
        <Field label="Tag colour" group>
          <div className="swatches">
            {KIT_COLORS.map((c) => <button key={c} type="button" className={`swatch-btn ${kit.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange({ color: c })} aria-label={c} />)}
          </div>
        </Field>
        <Field label="Palette" className="span2" group>
          <div className="row wrap">
            {(kit.palette || []).map((c) => (
              <button key={c} type="button" className="palette-chip" onClick={() => onChange({ palette: kit.palette.filter((x) => x !== c) })} title="Remove">
                <span style={{ background: c }} />{c}<Icon name="x" size={10} />
              </button>
            ))}
            <input className="hex-input" value={hex} onChange={(e) => setHex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColor() } }} placeholder="#C9A96E" aria-label="Add colour" />
            <IconBtn icon="plus" label="Add colour" onClick={addColor} />
          </div>
        </Field>
        {KIT_FIELDS.map(([key, label, ph]) => (
          <Field key={key} label={label} className={key === 'intent' ? 'span2' : ''}>
            <input value={kit[key] || ''} onChange={(e) => onChange({ [key]: e.target.value })} placeholder={ph} />
          </Field>
        ))}
      </div>
      {(kit.refImageIds || []).length > 0 && (
        <>
          <span className="label">Reference photos</span>
          <div className="ref-strip">
            {kit.refImageIds.map((id) => images.get(id) && (
              <div key={id} className="ref-tile">
                <Frame image={images.get(id)} aspect="4:5" />
                <IconBtn icon="x" label="Remove reference" className="tile-x" onClick={() => onChange({ refImageIds: kit.refImageIds.filter((x) => x !== id) })} />
              </div>
            ))}
          </div>
        </>
      )}
      <p className="field-hint">Add reference photos from the Library: select photos, then “Set theme”.</p>
    </div>
  )
}

// ---- Shot list -----------------------------------------------------------------------------

function ShotList() {
  const { doc, update, toast } = useStore()
  const { busy, run } = useRunner()
  const list = doc.shotList
  const done = new Set(list?.done || [])
  const make = () => run('shots', async (signal) => {
    const res = await shotList(doc, { signal })
    update({ shotList: { ...res, done: [], at: now() } })
    toast('Shot list ready', { kind: 'success' })
  })
  const toggle = (key) => update((d) => {
    const s = new Set(d.shotList?.done || [])
    if (s.has(key)) s.delete(key)
    else s.add(key)
    return { ...d, shotList: { ...d.shotList, done: [...s] } }
  })
  const asText = list ? SHOTLIST_SECTIONS.map(([k, label]) => (Array.isArray(list[k]) && list[k].length ? `${label}\n${list[k].map((x) => `- ${x}`).join('\n')}` : '')).filter(Boolean).join('\n\n') : ''
  return (
    <section className="card">
      <header className="card-head">
        <h2><span className="sec-num">6</span>Shot list <span className="optional">optional</span></h2>
        <div className="row">
          {list && <CopyBtn text={asText} />}
          <Btn size="sm" kind={list ? 'ghost' : ''} icon="sparkle" busy={busy === 'shots'} onClick={make}>{list ? 'Redo' : 'Generate'}</Btn>
        </div>
      </header>
      {!list ? <p className="field-hint">Before a shoot: a checklist of shots that will fill the grid, built from the brief and themes.</p> : (
        <div className="shot-sections">
          {SHOTLIST_SECTIONS.map(([k, label]) => Array.isArray(list[k]) && list[k].length > 0 && (
            <div key={k} className="shot-section">
              <span className="label">{label}</span>
              {list[k].map((s, i) => {
                const key = `${k}:${i}`
                return (
                  <label key={key} className={`check-row ${done.has(key) ? 'done' : ''}`}>
                    <input type="checkbox" checked={done.has(key)} onChange={() => toggle(key)} />
                    <span>{typeof s === 'string' ? s : JSON.stringify(s)}</span>
                  </label>
                )
              })}
            </div>
          ))}
          {list.equipment_notes && <p className="field-hint">{list.equipment_notes}</p>}
        </div>
      )}
    </section>
  )
}

// ---- Side panel ----------------------------------------------------------------------------

function Versions() {
  const { doc, update, toast } = useStore()
  const [open, setOpen] = useState(false)
  const save = () => {
    update((d) => ({
      ...d,
      briefVersions: [{ version: d.brief.version, brief: d.brief, at: now() }, ...d.briefVersions].slice(0, 10),
      brief: { ...d.brief, version: (d.brief.version || 1) + 1, updatedAt: now() },
    }))
    toast(`Saved as version ${doc.brief.version}. Captions written before now will be flagged in Review.`, { kind: 'success' })
  }
  const restore = (v) => {
    if (!confirmAction(`Restore version ${v.version}? The current brief is saved as a version first.`)) return
    update((d) => ({
      ...d,
      briefVersions: [{ version: d.brief.version, brief: d.brief, at: now() }, ...d.briefVersions].slice(0, 10),
      brief: { ...v.brief, version: (d.brief.version || 1) + 1, updatedAt: now() },
    }))
  }
  return (
    <div className="versions">
      <div className="row">
        <span className="field-hint">Version {doc.brief.version}</span>
        <span className="grow" />
        <Btn size="sm" kind="ghost" icon="bookmark" onClick={save} tip="Snapshot the brief. Captions written against an older version get flagged in Review.">Save version</Btn>
        {doc.briefVersions.length > 0 && <IconBtn icon="clock" label="Earlier versions" onClick={() => setOpen(true)} />}
      </div>
      {open && (
        <Modal title="Brief versions" onClose={() => setOpen(false)}>
          {doc.briefVersions.map((v) => (
            <div key={`${v.version}-${v.at}`} className="list-row">
              <span>Version {v.version}</span>
              <span className="field-hint">{new Date(v.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              <span className="grow" />
              <Btn size="sm" kind="ghost" onClick={() => { restore(v); setOpen(false) }}>Restore</Btn>
            </div>
          ))}
        </Modal>
      )}
    </div>
  )
}

function Research() {
  const { doc, update, toast } = useStore()
  const { busy, run, cancel } = useRunner()
  const [expanded, setExpanded] = useState(false)
  const r = doc.research
  const go = () => run('research', async (signal) => {
    const text = await research(doc.brief.client, { withSearch: true, signal })
    update((d) => ({ ...d, research: { ...d.research, text, updatedAt: now() } }))
    toast('Research added to the brief', { kind: 'success' })
  })
  return (
    <section className="card">
      <header className="card-head">
        <h3><Icon name="search" size={14} /> Research</h3>
        {busy ? <Btn size="sm" kind="ghost" onClick={cancel}>Stop</Btn> : <Btn size="sm" kind={r.text ? 'ghost' : ''} icon="sparkle" onClick={go} disabled={!doc.brief.client} tip={doc.brief.client ? 'Claude searches the web for the brand, its audience and competitors' : 'Add the client or brand name first.'}>{r.text ? 'Redo' : 'Research'}</Btn>}
      </header>
      {busy && <p className="status-line"><Icon name="search" size={12} /> Searching the web for {doc.brief.client}…</p>}
      {r.text ? (
        <>
          <div className={`research-text ${expanded ? 'open' : ''}`}>{r.text}</div>
          <div className="row">
            <button type="button" className="link-btn" onClick={() => setExpanded(!expanded)}>{expanded ? 'Less' : 'More'}</button>
            <span className="grow" />
            <label className="check-row small"><input type="checkbox" checked={r.useInPrompts} onChange={(e) => update((d) => ({ ...d, research: { ...d.research, useInPrompts: e.target.checked } }))} />Use in prompts</label>
          </div>
        </>
      ) : !busy && <p className="field-hint">Web research on the brand, audience and competitors. It feeds every plan and caption.</p>}
    </section>
  )
}

function References() {
  const { doc, update, addImageFiles, thumbs, toast } = useStore()
  const { busy, run } = useRunner()
  const [url, setUrl] = useState('')
  const input = useRef(null)
  const refs = doc.references
  const setRef = (id, patch) => update((d) => ({ ...d, references: d.references.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))

  const analyse = (ref) => run(`ref:${ref.id}`, async (signal) => {
    try {
      const analysis = ref.kind === 'link' ? await analyseLayoutUrl(ref.url, { signal }) : await analyseReferenceScreenshot(ref.imageId, { signal })
      setRef(ref.id, { analysis, error: '' })
    } catch (err) {
      if (err?.name !== 'AbortError') setRef(ref.id, { error: err.message })
      throw err
    }
  })

  const upload = async (files) => {
    const res = await addImageFiles(files, { role: 'reference' })
    if (!res?.ids?.length) return
    const fresh = res.ids.map((imageId, i) => ({ id: uid('r'), kind: 'screenshot', url: '', imageId, title: files[i]?.name || 'Screenshot', analysis: '', error: '', addedAt: now() }))
    update((d) => ({ ...d, references: [...fresh, ...d.references] }))
    for (const r of fresh) await analyse(r)
  }
  const addUrl = async () => {
    const u = url.trim()
    if (!/^https?:\/\//i.test(u)) {
      toast('Paste a full link starting with https://', { kind: 'error' })
      return
    }
    const ref = { id: uid('r'), kind: 'link', url: u, imageId: null, title: u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40), analysis: '', error: '', addedAt: now() }
    update((d) => ({ ...d, references: [ref, ...d.references] }))
    setUrl('')
    await analyse(ref)
  }
  return (
    <section className="card">
      <header className="card-head">
        <h3><Icon name="layers" size={14} /> Grid references</h3>
        <Btn size="sm" kind="ghost" icon="upload" onClick={() => input.current?.click()}>Screenshot</Btn>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = '' }} />
      </header>
      <p className="field-hint">Screenshots of grids you like. Claude turns each into a slot-by-slot template the planner follows.</p>
      <div className="row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="or paste a profile link" onKeyDown={(e) => { if (e.key === 'Enter') addUrl() }} aria-label="Reference link" />
        <IconBtn icon="plus" label="Add link" onClick={addUrl} />
      </div>
      {refs.map((r) => (
        <div key={r.id} className="ref-item">
          {r.imageId && thumbs[r.imageId] ? <span className="ref-thumb" style={{ backgroundImage: `url("${thumbs[r.imageId]}")` }} /> : <span className="ref-thumb"><Icon name="link" size={14} /></span>}
          <div className="ref-body">
            <span className="ref-title">{r.title}</span>
            {busy === `ref:${r.id}` ? <span className="field-hint">Reading the layout…</span>
              : r.error ? <span className="error-text">{r.error}</span>
              : r.analysis ? <details><summary className="field-hint">Template ready</summary><p className="small-text">{r.analysis}</p></details>
              : <button type="button" className="link-btn" onClick={() => analyse(r)}>Analyse</button>}
          </div>
          <IconBtn icon="x" label="Remove reference" onClick={() => update((d) => ({ ...d, references: d.references.filter((x) => x.id !== r.id) }))} />
        </div>
      ))}
    </section>
  )
}

function Learnings() {
  const { doc, update, go } = useStore()
  const list = doc.learnings
  const set = (id, patch) => update((d) => ({ ...d, learnings: d.learnings.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const active = useMemo(() => list.filter((l) => l.active).length, [list])
  return (
    <section className="card">
      <header className="card-head">
        <h3><Icon name="chart" size={14} /> Learnings</h3>
        {list.length > 0 && <span className="field-hint">{active} in use</span>}
      </header>
      {list.length === 0 ? (
        <p className="field-hint">What worked on past posts. Generate them in <button type="button" className="link-btn" onClick={() => go('measure')}>Measure</button> once posts have insights — active ones steer every plan and caption.</p>
      ) : list.map((l) => (
        <div key={l.id} className={`learning ${l.active ? '' : 'off'}`}>
          <label className="check-row"><input type="checkbox" checked={l.active} onChange={(e) => set(l.id, { active: e.target.checked })} /><span>{l.text}</span></label>
          {l.evidence && <span className="field-hint">{l.evidence} · {l.confidence} confidence</span>}
          <IconBtn icon="x" label="Delete learning" onClick={() => update((d) => ({ ...d, learnings: d.learnings.filter((x) => x.id !== l.id) }))} />
        </div>
      ))}
    </section>
  )
}
