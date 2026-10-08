// Review: every filled post with its pre-flight checks, approval, and the client portal.
import { useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Btn, Empty, Modal, Frame, useRunner } from '../components/ui.jsx'
import { CarouselModal } from '../components/media.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import {
  byId, postLabelAt, coverImageId, isPublished, formatLabel, postStage, STAGE_LABELS, publishImageIds,
} from '../data/model.js'
import { postChecks, blocking, checkSummary } from '../lib/checks.js'
import { portalStats, buildPortal, portalFilename } from '../lib/portal.js'
import { downloadText } from '../lib/download.js'
import { formatIst } from '../lib/time.js'

const FILTERS = [['all', 'All'], ['issues', 'Needs work'], ['ready', 'Ready'], ['approved', 'Approved']]
const LEVEL_ICON = { error: 'x', warn: 'warning', info: 'info' }
const STEP_NAME = { plan: 'Plan', create: 'Create', write: 'Write', schedule: 'Schedule' }

export default function Review() {
  const { doc, update, toast, go } = useStore()
  const [filter, setFilter] = useState('all')
  const [preview, setPreview] = useState(null)
  const [portal, setPortal] = useState(false)
  const images = byId(doc.images)

  const rows = useMemo(() => doc.posts
    .map((p, i) => ({ p, label: postLabelAt(doc.posts, i), checks: postChecks(p, doc, images) }))
    .filter(({ p }) => p.slides.length || p.design?.exportImageId || p.format === 'reel'),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [doc.posts, doc.images, doc.brief?.version])

  const kind = ({ p, checks }) => (isPublished(p) ? 'live' : p.approved ? 'approved' : checkSummary(checks).ok ? 'ready' : 'issues')
  const counts = Object.fromEntries(FILTERS.map(([id]) => [id, id === 'all' ? rows.length : rows.filter((r) => kind(r) === id).length]))
  const shown = rows.filter((r) => filter === 'all' || kind(r) === filter)
  const ready = rows.filter((r) => kind(r) === 'ready')

  const setApproved = (ids, on) => {
    const set = new Set(ids)
    update((d) => ({ ...d, posts: d.posts.map((p) => (set.has(p.id) ? { ...p, approved: on } : p)) }))
  }
  const approve = (r) => {
    if (blocking(r.checks)) return
    setApproved([r.p.id], true)
    toast(`${r.label} approved`, { kind: 'success', action: { label: 'Undo', fn: () => setApproved([r.p.id], false) } })
  }
  const approveReady = () => {
    const ids = ready.map((r) => r.p.id)
    setApproved(ids, true)
    toast(`${ids.length} post${ids.length > 1 ? 's' : ''} approved`, { kind: 'success', action: { label: 'Schedule', fn: () => go('schedule') } })
  }

  if (!rows.length) {
    return (
      <div className="page review">
        <Empty icon="review" title="Nothing to review yet" action={<Btn kind="primary" icon="grid" onClick={() => go('plan')}>Plan the grid</Btn>}>
          Posts appear here once they have images.
        </Empty>
      </div>
    )
  }

  return (
    <div className="page review">
      <div className="toolbar">
        <div className="pool-tabs">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
              {label} <span className="count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        <Btn kind="ghost" icon="share" onClick={() => setPortal(true)} tip="A single HTML file a client can open without logging in">Client review</Btn>
        <Btn kind="primary" icon="check" disabled={!ready.length} onClick={approveReady} tip="Approve every post with no errors or warnings">Approve {ready.length || ''} ready</Btn>
      </div>

      {!shown.length && <p className="field-hint pad">No posts in this view.</p>}
      <div className="review-list">
        {shown.map((r) => (
          <ReviewCard
            key={r.p.id}
            row={r}
            image={images.get(coverImageId(r.p))}
            state={kind(r)}
            onPreview={() => setPreview(r)}
            onApprove={() => approve(r)}
            onUnapprove={() => setApproved([r.p.id], false)}
            onFix={(step) => go(step, { postId: r.p.id })}
          />
        ))}
      </div>

      {preview && <CarouselModal post={doc.posts.find((p) => p.id === preview.p.id) || preview.p} label={preview.label} onClose={() => setPreview(null)} />}
      {portal && <PortalModal onClose={() => setPortal(false)} />}
    </div>
  )
}

function ReviewCard({ row, image, state, onPreview, onApprove, onUnapprove, onFix }) {
  const { p, label, checks } = row
  const stage = postStage(p)
  const slides = publishImageIds(p).length
  const blocked = blocking(checks)
  const text = p.caption?.text?.trim() || ''
  return (
    <article className={`review-card ${state}`}>
      <button type="button" className="review-cover" onClick={onPreview} aria-label={`Preview ${label}`}>
        <Frame image={image} crop={p.design?.exportImageId ? null : p.slides[0]?.crop} aspect={p.aspect} />
        {slides > 1 && <span className="review-count"><Icon name="carousel" size={12} /> {slides}</span>}
      </button>
      <div className="review-body">
        <div className="review-head">
          <strong>{label}</strong>
          <span className="mute">{formatLabel(p.format)}</span>
          <span className={`stage-chip ${stage}`}>{STAGE_LABELS[stage]}</span>
        </div>
        {text ? <p className="review-caption">{text}</p> : <p className="review-caption mute">No caption</p>}
        {p.schedule?.at && !isPublished(p) && <p className="review-meta"><Icon name="clock" size={12} /> {formatIst(p.schedule.at)} IST</p>}
        {checks.length > 0 && (
          <ul className="check-list">
            {checks.map((c) => (
              <li key={c.id} className={c.level}>
                <Icon name={LEVEL_ICON[c.level]} size={13} />
                <span>{c.text}</span>
                {c.step && <button type="button" className="link-btn" onClick={() => onFix(c.step)}>{STEP_NAME[c.step]}</button>}
              </li>
            ))}
          </ul>
        )}
        {!checks.length && !isPublished(p) && <p className="check-ok"><Icon name="check" size={13} /> All checks pass</p>}
        <div className="review-actions">
          {isPublished(p) ? (
            p.publish.permalink
              ? <a className="btn ghost sm" href={p.publish.permalink} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> View on Instagram</a>
              : <span className="mute">Published</span>
          ) : p.approved ? (
            <>
              <span className="approved-tag"><Icon name="check" size={13} /> Approved</span>
              <Btn size="sm" kind="ghost" onClick={onUnapprove}>Unapprove</Btn>
            </>
          ) : (
            <Btn size="sm" kind="primary" icon="check" disabled={blocked} onClick={onApprove} tip={blocked ? 'Fix the errors first' : undefined}>Approve</Btn>
          )}
        </div>
      </div>
    </article>
  )
}

function PortalModal({ onClose }) {
  const { doc, settings, toast } = useStore()
  const { busy, run, cancel } = useRunner()
  const [progress, setProgress] = useState(null)
  const stats = portalStats(doc)

  const download = async () => {
    const html = await run('portal', (signal) => buildPortal(doc, {
      handle: settings.handle,
      onProgress: (done, total) => setProgress({ done, total }),
      signal,
    }))
    setProgress(null)
    if (!html) return
    downloadText(html, portalFilename(), 'text/html')
    toast('Client review downloaded', { kind: 'success' })
    onClose()
  }

  const footer = busy
    ? <Btn kind="ghost" onClick={cancel}>Cancel</Btn>
    : <><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="download" disabled={!stats.posts} onClick={download}>Download Client Review</Btn></>

  return (
    <Modal title="Client Review Portal" onClose={busy ? undefined : onClose} footer={footer} width={480}>
      <div className="stat-row">
        <div className="stat"><span className="big-num">{stats.posts}</span><span className="label">Posts</span></div>
        <div className="stat"><span className="big-num">{stats.captioned}</span><span className="label">Captioned</span></div>
        <div className="stat"><span className="big-num">{stats.approved}</span><span className="label">Approved</span></div>
      </div>
      <p className="field-hint">One self-contained HTML file with every post, its slides and caption. Share the HTML file via email, WhatsApp, or Dropbox — no login needed.</p>
      {progress && <p className="status-line"><Icon name="image" size={13} /> Preparing images {progress.done} of {progress.total}…</p>}
    </Modal>
  )
}
