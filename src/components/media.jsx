// Image widgets shared by several steps: crop editor, carousel preview, Drive import.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Btn, IconBtn, Modal, Frame, Field, useAbortable } from './ui.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { DEFAULT_CROP, byId, publishImageIds, formatLabel } from '../data/model.js'
import { extractFolderId, importDriveFolders } from '../lib/drive.js'
import { isAbort, errorMessage } from '../lib/api.js'

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

// Drag to move the focal point, slider or wheel to zoom.
export function CropView({ image, crop, aspect = '4:5', onChange, className = '' }) {
  const c = { ...DEFAULT_CROP, ...(crop || {}) }
  const ref = useRef(null)
  const drag = useRef(null)
  const set = (patch) => onChange({ ...c, ...patch })

  const down = (e) => {
    if (!image) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, start: c }
  }
  const move = (e) => {
    const d = drag.current
    if (!d || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const k = 1 / Math.max(1, d.start.zoom)
    set({ x: clamp(d.start.x - ((e.clientX - d.x) / r.width) * k * 1.6), y: clamp(d.start.y - ((e.clientY - d.y) / r.height) * k * 1.6) })
  }
  const up = () => { drag.current = null }
  const wheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    set({ zoom: clamp(c.zoom - e.deltaY * 0.002, 1, 3) })
  }

  return (
    <div className={`cropview ${className}`}>
      <div ref={ref} className="cropview-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        <Frame image={image} crop={c} aspect={aspect} full>
          <span className="crop-grid" aria-hidden="true" />
        </Frame>
      </div>
      <div className="cropview-controls">
        <Icon name="zoomOut" size={14} />
        <input type="range" min="1" max="3" step="0.01" value={c.zoom} onChange={(e) => set({ zoom: Number(e.target.value) })} aria-label="Zoom" />
        <Icon name="zoomIn" size={14} />
        <IconBtn icon="refresh" label="Reset crop" onClick={() => onChange({ ...DEFAULT_CROP })} />
      </div>
      <p className="field-hint">Drag to reposition. Ctrl/⌘ + scroll to zoom.</p>
    </div>
  )
}

// What a post will look like on Instagram: one slide at a time, swipe with arrows.
export function CarouselModal({ post, label, onClose }) {
  const { doc } = useStore()
  const images = byId(doc.images)
  const ids = publishImageIds(post)
  const [i, setI] = useState(0)
  const n = ids.length
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setI((v) => Math.min(n - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n])
  const id = ids[i]
  const isDesign = post.design?.exportImageId && id === post.design.exportImageId
  const crop = isDesign ? null : post.slides.find((s) => s.imageId === id)?.crop
  return (
    <Modal title={`${label || 'Post'} · ${formatLabel(post.format)}`} onClose={onClose} width={520}>
      {n ? (
        <div className="carousel">
          <Frame image={images.get(id)} crop={crop} aspect={post.aspect} full className="carousel-frame" />
          {n > 1 && (
            <div className="carousel-nav">
              <IconBtn icon="left" label="Previous" disabled={i === 0} onClick={() => setI(i - 1)} />
              <div className="carousel-dots">
                {ids.map((x, j) => <button key={`${x}${j}`} type="button" className={j === i ? 'on' : ''} onClick={() => setI(j)} aria-label={`Slide ${j + 1}`} />)}
              </div>
              <IconBtn icon="right" label="Next" disabled={i === n - 1} onClick={() => setI(i + 1)} />
            </div>
          )}
          {post.caption?.text && <p className="carousel-caption">{post.caption.text}</p>}
        </div>
      ) : (
        <p className="field-hint">This post has no images yet.</p>
      )}
    </Modal>
  )
}

// Import every image in one or more shared Drive folders.
export function DriveImport({ onClose, onDone }) {
  const { settings, updateSettings, doc, addProcessed, toast, go } = useStore()
  const [rows, setRows] = useState([''])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const job = useAbortable()
  const history = settings.driveHistory || []

  const run = async () => {
    const ids = rows.map(extractFolderId).filter(Boolean)
    if (!ids.length) {
      setError('Paste a Google Drive folder link.')
      return
    }
    setBusy(true)
    setError('')
    const signal = job.start()
    try {
      const existing = new Set([...doc.images.map((i) => i.driveId).filter(Boolean), ...doc.excludedNames])
      const res = await importDriveFolders(ids, settings.googleKey, { existing, onStatus: setStatus, signal })
      const stored = await addProcessed(res.entries)
      const urls = rows.filter((r) => extractFolderId(r))
      updateSettings((s) => ({ driveHistory: [...new Set([...urls, ...(s.driveHistory || [])])].slice(0, 10) }))
      const parts = [`${stored.added} added`]
      if (stored.relinked) parts.push(`${stored.relinked} re-linked`)
      if (res.skipped) parts.push(`${res.skipped} already in library`)
      if (stored.duplicates) parts.push(`${stored.duplicates} look like duplicates`)
      if (res.errors.length) parts.push(`${res.errors.length} failed`)
      toast(parts.join(' · '), { kind: res.errors.length ? 'info' : 'success' })
      onDone?.(stored)
      onClose()
    } catch (err) {
      if (!isAbort(err)) setError(errorMessage(err))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const footer = busy
    ? <Btn kind="ghost" onClick={() => job.cancel()}>Cancel</Btn>
    : <><Btn kind="ghost" onClick={onClose}>Close</Btn><Btn kind="primary" icon="drive" onClick={run} disabled={!settings.googleKey}>Import</Btn></>

  return (
    <Modal title="Import from Google Drive" onClose={busy ? undefined : onClose} footer={footer}>
      {!settings.googleKey && (
        <div className="banner warn inline">
          <Icon name="key" size={14} />
          <span>Add a Google API key with the Drive API enabled first.</span>
          <Btn size="sm" kind="ghost" onClick={() => { onClose(); go('settings') }}>Settings</Btn>
        </div>
      )}
      <p className="field-hint">Folders must be shared as “Anyone with the link”. Images already in the library, or ones you deleted, are skipped.</p>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <input value={r} placeholder="https://drive.google.com/drive/folders/…" onChange={(e) => setRows(rows.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Folder ${i + 1}`} disabled={busy} />
          {rows.length > 1 && <IconBtn icon="x" label="Remove folder" onClick={() => setRows(rows.filter((_, j) => j !== i))} />}
        </div>
      ))}
      {!busy && <Btn size="sm" kind="ghost" icon="plus" onClick={() => setRows([...rows, ''])}>Another folder</Btn>}
      {history.length > 0 && !busy && (
        <Field label="Recent folders" group>
          <div className="chips">
            {history.map((h) => (
              <button key={h} type="button" className="chip" onClick={() => setRows((rs) => (rs.includes(h) ? rs : [...rs.filter(Boolean), h]))} title={h}>
                {h.replace(/^https?:\/\/drive\.google\.com\/drive\/(u\/\d+\/)?folders\//, '').slice(0, 18)}…
              </button>
            ))}
          </div>
        </Field>
      )}
      {status && <p className="status-line"><Icon name="drive" size={13} /> {status}</p>}
      {error && <p className="error-text">{error}</p>}
    </Modal>
  )
}

// ---- Image tiles (Library and Plan) ----------------------------------------------------------

export const DRAG_IMAGES = 'application/x-kss-image'
export const DRAG_POST = 'application/x-kss-post'
export const DRAG_SLIDE = 'application/x-kss-slide'

export const dragIds = (e) => (e.dataTransfer.getData(DRAG_IMAGES) || '').split(',').filter(Boolean)
export const hasDrag = (e, type) => [...(e.dataTransfer?.types || [])].includes(type)

const CULL_TIP = { keep: 'Keep', maybe: 'Maybe', reject: 'Rejected' }

// A photo in a grid of photos. `uses` is the usageMap() entry; `dragIds` the ids to carry.
export function Tile({ image, uses, kit, selected, shortlisted, dim, onClick, onDoubleClick, dragIdsFor, fit = false, children }) {
  const { thumbs } = useStore()
  const url = thumbs[image.id]
  const used = uses?.length ? uses : null
  const onDragStart = dragIdsFor
    ? (e) => {
      e.dataTransfer.setData(DRAG_IMAGES, dragIdsFor(image.id).join(','))
      e.dataTransfer.effectAllowed = 'copyMove'
    }
    : undefined
  return (
    <div
      className={`tile ${selected ? 'selected' : ''} ${dim ? 'dim' : ''} ${used ? 'used' : ''} ${url ? '' : 'loading'}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      draggable={!!dragIdsFor}
      onDragStart={onDragStart}
      role="button"
      tabIndex={0}
      aria-pressed={!!selected}
      aria-label={image.name || 'Photo'}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(e) } }}
    >
      <span className="tile-img" style={{ backgroundImage: url ? `url("${url}")` : undefined, backgroundSize: fit ? 'contain' : 'cover' }} />
      {kit && <span className="tile-kit" style={{ background: kit.color }} title={kit.name} />}
      <span className="tile-badges">
        {shortlisted && <span className="badge star" title="Shortlisted"><Icon name="star" size={10} /></span>}
        {image.cull && image.cull !== 'reject' && <span className={`badge cull-${image.cull}`} title={CULL_TIP[image.cull]}>{image.cull === 'keep' ? 'K' : 'M'}</span>}
        {image.dupOf && <span className="badge warn" title="Looks like a duplicate"><Icon name="copy" size={10} /></span>}
        {!image.analysedAt && image.role !== 'reference' && image.role !== 'design' && <span className="badge mute" title="Not analysed yet"><Icon name="sparkle" size={10} /></span>}
      </span>
      {used && (
        <span className={`tile-used ${used.some((u) => u.posted) ? 'posted' : ''}`}>
          {used.slice(0, 2).map((u) => `${u.label}${u.slide ? `·${u.slide + 1}` : ''}`).join(' ')}{used.length > 2 ? ` +${used.length - 2}` : ''}
        </span>
      )}
      {children}
    </div>
  )
}
