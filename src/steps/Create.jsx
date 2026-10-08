// Create: social graphics. Claude reads the photo, writes the copy, plans a layout and builds
// it as HTML; the studio previews it in a sandboxed frame and renders it to a JPEG that
// replaces slide 1 when the post is published.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Btn, IconBtn, Field, Empty, Segmented, Frame, useRunner, confirmAction } from '../components/ui.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { byId, postLabelAt, emptyDesign, isPublished, formatLabel } from '../data/model.js'
import { DESIGN_SIZES, INJECT_IMG, previewDoc, generateCopy, generateDesign, refineDesign, exportDesign } from '../lib/design.js'
import { COPY_TONES, COPY_FIELDS, DIRECTION_PRESETS, REFINE_HINTS } from '../lib/prompts.js'
import { briefContext } from '../lib/brief.js'
import { processFile, visionDataUrl, getFullBlob } from '../data/media.js'
import { downloadBlob } from '../lib/download.js'

const MAX_VERSIONS = 10
const typing = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.target?.isContentEditable

export default function Create() {
  const { doc, update, getDoc, settings, toast, go, route, session, addProcessed, addImageFiles, deleteImages } = useStore()
  const { busy, run, cancel } = useRunner()
  const [step, setStep] = useState('')
  const [refineText, setRefineText] = useState('')
  const [showCode, setShowCode] = useState(false)

  const candidates = useMemo(() => doc.posts.map((p, i) => ({ p, i })).filter(({ p }) => p.slides.length && !isPublished(p)), [doc.posts])
  const [postId, setPostId] = useState(route.params?.postId || null)
  useEffect(() => { if (route.params?.postId) setPostId(route.params.postId) }, [route.params?.postId])
  const index = doc.posts.findIndex((p) => p.id === postId)
  const post = index >= 0 ? doc.posts[index] : candidates[0]?.p || null
  const label = post ? postLabelAt(doc.posts, doc.posts.indexOf(post)) : ''
  const design = post?.design || emptyDesign()
  const images = byId(doc.images)
  const slideIndex = Math.min(design.slideIndex || 0, Math.max(0, (post?.slides.length || 1) - 1))
  const imageId = post?.slides[slideIndex]?.imageId || null
  const references = doc.images.filter((i) => i.role === 'reference')
  const serverOk = session?.server && session?.authed

  const patchDesign = (patch) => {
    if (!post) return
    update((d) => ({
      ...d,
      posts: d.posts.map((p) => {
        if (p.id !== post.id) return p
        const cur = p.design || emptyDesign()
        return { ...p, design: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } }
      }),
    }))
  }
  const currentDesign = () => getDoc().posts.find((p) => p.id === post?.id)?.design || emptyDesign()

  const moveBy = (n) => {
    if (!candidates.length) return
    const at = candidates.findIndex(({ p }) => p.id === post?.id)
    const next = candidates[(at + n + candidates.length) % candidates.length]
    setPostId(next.p.id)
  }

  const context = () => briefContext(getDoc(), { themeId: post?.themeId })
  const direction = () => {
    const preset = DIRECTION_PRESETS.find(([l]) => l === design.direction)
    return [preset?.[2], design.customDirection].filter(Boolean).join('\n')
  }

  const runCopy = async () => {
    const d = currentDesign()
    const res = await run('copy', (signal) => generateCopy({
      imageId,
      context: context(),
      handle: settings.handle,
      website: settings.website,
      tone: d.tone,
      analysis: d.analysis,
      copy: d.copy,
      lockedFields: d.lockedFields,
      signal,
    }))
    if (!res) return
    patchDesign({ copy: res.copy, headlines: res.headlines })
    toast('Copy generated', { kind: 'success' })
  }

  const runDesign = async () => {
    if (!imageId) return
    const d = currentDesign()
    const res = await run('design', (signal) => generateDesign({
      imageId,
      mode: d.mode,
      copy: d.copy,
      context: context(),
      handle: settings.handle,
      website: settings.website,
      direction: direction(),
      refImageId: d.refImageId,
      analysis: d.analysis && d.analysisFor === imageId ? d.analysis : null,
      onStep: setStep,
      signal,
    }))
    setStep('')
    if (!res) return
    patchDesign((cur) => ({
      html: res.html,
      plan: res.plan,
      analysis: res.analysis,
      analysisFor: imageId,
      refStyle: res.refStyle,
      exportImageId: null,
      versions: cur.html ? [{ html: cur.html, at: new Date().toISOString() }, ...cur.versions].slice(0, MAX_VERSIONS) : cur.versions,
    }))
    toast(res.analysis?.suggestedTextZone ? `Design generated. Text placed in ${res.analysis.suggestedTextZone}` : 'Design generated', { kind: 'success' })
  }

  const runRefine = async (msg) => {
    const text = (msg ?? refineText).trim()
    const d = currentDesign()
    if (!text || !d.html) return
    const html = await run('refine', (signal) => refineDesign(d.html, text, { signal }))
    if (!html) return
    patchDesign((cur) => ({ html, exportImageId: null, versions: [{ html: cur.html, at: new Date().toISOString(), note: text }, ...cur.versions].slice(0, MAX_VERSIONS) }))
    setRefineText('')
  }

  const runExport = async () => {
    const d = currentDesign()
    if (!d.html || !imageId) return
    const id = await run('export', async (signal) => {
      const blob = await exportDesign(d.html, imageId, d.mode, { signal })
      const entry = await processFile(blob, { name: `${label}-design.jpg`, role: 'design', source: 'design' })
      const res = await addProcessed([entry])
      return res.ids[0]
    })
    if (!id) return
    const old = d.exportImageId
    patchDesign({ exportImageId: id })
    toast(`Exported — the graphic replaces slide 1 of ${label} when it’s published.`, {
      kind: 'success',
      action: { label: 'Download', fn: () => download(id) },
    })
    // The previous export is replaced, not kept: it would only clutter the Designs shelf.
    if (old && old !== id) deleteImages([old])
  }

  const download = async (id) => {
    const blob = await getFullBlob(id)
    if (blob) downloadBlob(blob, `${label}-design.jpg`)
  }

  const restore = (v) => {
    patchDesign((cur) => ({ html: v.html, exportImageId: null, versions: [{ html: cur.html, at: new Date().toISOString() }, ...cur.versions.filter((x) => x !== v)].slice(0, MAX_VERSIONS) }))
  }

  const clearDesign = () => {
    if (!confirmAction(`Remove the graphic from ${label}? The photo stays.`)) return
    update((d) => ({ ...d, posts: d.posts.map((p) => (p.id === post.id ? { ...p, design: null } : p)) }))
  }

  useEffect(() => {
    const onKey = (e) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || busy) return
      if (e.key === 'ArrowRight') moveBy(1)
      else if (e.key === 'ArrowLeft') moveBy(-1)
      else if (e.key.toLowerCase() === 'g') runDesign()
      else if (e.key.toLowerCase() === 'e' && design.html && serverOk) runExport()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!candidates.length && !post) {
    return (
      <Empty icon="create" title="No posts to design yet" action={<Btn kind="primary" icon="grid" onClick={() => go('plan')}>Go to Plan</Btn>}>
        Graphics are made for posts in the plan. Put some photos into posts first.
      </Empty>
    )
  }

  return (
    <div className="create">
      {/* Filmstrip of posts */}
      <nav className="filmstrip" aria-label="Posts">
        <span className="label">Posts</span>
        {candidates.map(({ p, i }) => (
          <button key={p.id} type="button" className={`film ${p.id === post?.id ? 'on' : ''}`} onClick={() => setPostId(p.id)} aria-current={p.id === post?.id}>
            <Frame image={images.get(p.design?.exportImageId || p.slides[0]?.imageId)} aspect="4:5" />
            <span className="film-label">{postLabelAt(doc.posts, i)}</span>
            {p.design?.exportImageId ? <span className="film-dot done" title="Graphic exported" /> : p.design?.html ? <span className="film-dot" title="Draft graphic" /> : null}
          </button>
        ))}
      </nav>

      {/* Preview */}
      <section className="create-stage" aria-label="Preview">
        <div className="toolbar">
          <h3 className="stage-title">{label} <span className="mute">· {formatLabel(post.format)}</span></h3>
          <span className="grow" />
          <Segmented size="sm" value={design.mode} onChange={(v) => patchDesign({ mode: v, exportImageId: null })} options={[['post', 'Post 4:5'], ['story', 'Story 9:16']]} />
          <IconBtn icon="eye" label={showCode ? 'Hide HTML' : 'Show HTML'} active={showCode} onClick={() => setShowCode(!showCode)} disabled={!design.html} />
        </div>
        {post.slides.length > 1 && (
          <div className="row slide-pick">
            <span className="label">Photo</span>
            {post.slides.map((s, i) => (
              <button key={`${s.imageId}${i}`} type="button" className={`slide-mini ${i === slideIndex ? 'on' : ''}`} onClick={() => patchDesign({ slideIndex: i })} aria-label={`Use slide ${i + 1}`}>
                <Frame image={images.get(s.imageId)} aspect="1:1" />
              </button>
            ))}
          </div>
        )}
        <Preview html={design.html} imageId={imageId} mode={design.mode} image={images.get(imageId)} busy={busy === 'design' ? step || 'Working…' : ''} />
        {showCode && design.html && <pre className="code-view">{design.html}</pre>}
        {design.html && (
          <form className="refine-bar" onSubmit={(e) => { e.preventDefault(); runRefine() }}>
            <Icon name="sparkle" size={14} />
            <input value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder="Change something: “move the headline lower”, “warmer overlay”" disabled={busy === 'refine'} aria-label="Refine the design" />
            {busy === 'refine' ? <Btn size="sm" kind="ghost" onClick={cancel}>Stop</Btn> : <Btn size="sm" kind="ghost" type="submit" disabled={!refineText.trim()}>Refine</Btn>}
          </form>
        )}
        {design.html && (
          <div className="chips">
            {REFINE_HINTS.map((h) => <button key={h} type="button" className="chip" onClick={() => runRefine(h)} disabled={!!busy}>{h}</button>)}
          </div>
        )}
        <div className="stage-actions">
          {busy === 'design'
            ? <Btn kind="ghost" onClick={cancel}>Stop</Btn>
            : <Btn kind="primary" icon="sparkle" onClick={runDesign} disabled={!imageId || !!busy} tip="Shortcut: G">{design.html ? 'Generate again' : 'Generate design'}</Btn>}
          <Btn
            kind={design.exportImageId ? 'ghost' : 'primary'}
            icon="download"
            onClick={runExport}
            busy={busy === 'export'}
            disabled={!design.html || !serverOk || (!!busy && busy !== 'export')}
            tip={serverOk ? 'Render a JPEG for publishing. Shortcut: E' : 'Exporting needs the studio server. Open the deployed studio.'}
          >
            {design.exportImageId ? 'Export again' : 'Export'}
          </Btn>
          {design.exportImageId && <Btn kind="ghost" icon="download" onClick={() => download(design.exportImageId)}>Download JPEG</Btn>}
          <span className="grow" />
          {(design.html || design.exportImageId) && <Btn kind="ghost" size="sm" icon="trash" onClick={clearDesign}>Remove graphic</Btn>}
        </div>
        {design.exportImageId && (
          <p className="field-hint"><Icon name="check" size={12} /> Exported. This graphic replaces slide 1 when {label} is published.</p>
        )}
        <p className="field-hint">Keys: G generate · E export · ← → switch post</p>
      </section>

      {/* Copy and direction */}
      <aside className="create-side" aria-label="Copy and direction">
        <div className="card">
          <div className="card-head">
            <span className="label">Copy</span>
            <Btn size="sm" kind="ghost" icon="sparkle" onClick={runCopy} busy={busy === 'copy'} disabled={!imageId || (!!busy && busy !== 'copy')}>Write copy</Btn>
          </div>
          <Field label="Tone" group>
            <div className="chips">
              {COPY_TONES.map((t) => <button key={t} type="button" className={`chip ${design.tone === t ? 'on' : ''}`} onClick={() => patchDesign({ tone: design.tone === t ? '' : t })}>{t}</button>)}
            </div>
          </Field>
          {COPY_FIELDS.map(([l, key, hint]) => {
            const locked = design.lockedFields.includes(key)
            return (
              <Field
                key={key}
                label={l}
                counter={<IconBtn icon={locked ? 'lock' : 'unlock'} size={12} label={locked ? 'Locked — Claude keeps it' : 'Lock this line'} active={locked} onClick={(e) => { e.preventDefault(); patchDesign((c) => ({ lockedFields: locked ? c.lockedFields.filter((k) => k !== key) : [...c.lockedFields, key] })) }} />}
              >
                <input value={design.copy[key] || ''} placeholder={hint} onChange={(e) => patchDesign((c) => ({ copy: { ...c.copy, [key]: e.target.value } }))} />
              </Field>
            )
          })}
          {design.headlines.length > 1 && (
            <Field label="Other headlines" group>
              <div className="chips">
                {design.headlines.map((h) => <button key={h} type="button" className={`chip ${design.copy.headline === h ? 'on' : ''}`} onClick={() => patchDesign((c) => ({ copy: { ...c.copy, headline: h } }))}>{h}</button>)}
              </div>
            </Field>
          )}
          <p className="field-hint">Leave the headline empty for a photo-only layout with just the handle.</p>
        </div>

        <div className="card">
          <div className="card-head"><span className="label">Direction</span></div>
          <div className="preset-grid">
            {DIRECTION_PRESETS.map(([l, short]) => (
              <button key={l} type="button" className={`preset ${design.direction === l ? 'on' : ''}`} onClick={() => patchDesign({ direction: design.direction === l ? '' : l })}>
                <strong>{l}</strong>
                <span>{short}</span>
              </button>
            ))}
          </div>
          <Field label="Your own direction">
            <textarea rows={2} value={design.customDirection} onChange={(e) => patchDesign({ customDirection: e.target.value })} placeholder="“Thin serif, all lowercase, type in the lower third”" />
          </Field>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="label">Reference design</span>
            <label className="btn ghost sm">
              <Icon name="upload" size={13} /><span>Add</span>
              <input type="file" accept="image/*" hidden onChange={async (e) => {
                const res = await addImageFiles(e.target.files, { role: 'reference', source: 'reference' })
                e.target.value = ''
                if (res?.ids?.[0]) patchDesign({ refImageId: res.ids[0] })
              }} />
            </label>
          </div>
          {references.length ? (
            <div className="ref-row">
              {references.map((r) => (
                <button key={r.id} type="button" className={`ref-thumb ${design.refImageId === r.id ? 'on' : ''}`} onClick={() => patchDesign({ refImageId: design.refImageId === r.id ? null : r.id })} title={r.name}>
                  <Frame image={r} aspect="1:1" />
                </button>
              ))}
            </div>
          ) : <p className="field-hint">Add a screenshot of a post whose style you want. Claude copies the type, layout and colour — not the content.</p>}
        </div>

        {design.versions.length > 0 && (
          <div className="card">
            <div className="card-head"><span className="label">Earlier versions</span></div>
            <div className="version-list">
              {design.versions.map((v, i) => (
                <div key={`${v.at}${i}`} className="version">
                  <span className="small-text">{new Date(v.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}{v.note ? ` · ${v.note}` : ''}</span>
                  <Btn size="sm" kind="ghost" icon="undo" onClick={() => restore(v)}>Restore</Btn>
                </div>
              ))}
            </div>
          </div>
        )}
        {!serverOk && (
          <div className="banner warn inline">
            <Icon name="cloud" size={14} />
            <span>Designing works here; exporting the JPEG needs the studio server.</span>
          </div>
        )}
      </aside>
    </div>
  )
}

// The template rendered at full size in a sandboxed frame, scaled to fit the stage.
function Preview({ html, imageId, mode, image, busy }) {
  const [w, h] = DESIGN_SIZES[mode === 'story' ? 'story' : 'post']
  const box = useRef(null)
  const [scale, setScale] = useState(0.4)
  const [src, setSrc] = useState('')
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const fit = () => setScale(Math.min(el.clientWidth / w, el.clientHeight / h))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [w, h])
  useEffect(() => {
    let alive = true
    if (!imageId) { setSrc(''); return undefined }
    visionDataUrl(imageId, 1600).then((u) => { if (alive) setSrc(u) }).catch(() => {})
    return () => { alive = false }
  }, [imageId])
  const srcDoc = useMemo(() => (html && src ? previewDoc(INJECT_IMG(html, src), w, h) : ''), [html, src, w, h])
  return (
    <div className="preview-box" ref={box}>
      <div className="preview-canvas" style={{ width: w * scale, height: h * scale }}>
        {srcDoc ? (
          <iframe
            title="Design preview"
            sandbox=""
            srcDoc={srcDoc}
            style={{ width: w, height: h, transform: `scale(${scale})` }}
          />
        ) : (
          <Frame image={image} aspect={w / h} full className="preview-photo">
            {!busy && <span className="preview-hint">Pick a direction, then Generate</span>}
          </Frame>
        )}
        {busy && <div className="preview-busy"><span className="spinner" /> {busy}</div>}
      </div>
    </div>
  )
}
