// Schedule: a two-week IST calendar. Drag approved posts onto days, auto-fill the open
// slots, publish now, and export a calendar file as a backup reminder.
import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Btn, IconBtn, Field, Empty, Frame, Modal, confirmAction } from '../components/ui.jsx'
import { CarouselModal, hasDrag } from '../components/media.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { publishNow, clearPublishError, isPublishing } from '../store/useScheduler.js'
import {
  byId, postLabelAt, coverImageId, isPublished, formatLabel, publishImageIds,
} from '../data/model.js'
import {
  WEEKDAYS, istDateKey, addDays, weekdayOf, istAt, istParts, formatIst, formatIstTime,
  fromIstLocalInput, toIstLocalInput, relativeTime,
} from '../lib/time.js'
import { autoSchedule, unscheduled, orderProblems, slotStatus } from '../lib/schedule.js'
import { suggestedSlots, measureRows } from '../lib/insights.js'
import { metaConfigured, MetaError } from '../lib/meta.js'
import { cloudinaryConfigured } from '../lib/cloudinary.js'
import { publishingLimit } from '../lib/publish.js'
import { buildIcs } from '../lib/ics.js'
import { downloadText } from '../lib/download.js'
import { errorMessage } from '../lib/api.js'

const DRAG_SCHEDULE = 'application/x-kss-schedule'
const STATUS_LABEL = { scheduled: 'Scheduled', due: 'Due', publishing: 'Publishing', error: 'Failed', published: 'Published', unapproved: 'Not approved' }
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`
const mondayOf = (key) => addDays(key, -((weekdayOf(key) + 6) % 7))

export default function Schedule() {
  const store = useStore()
  const { doc, update, settings, toast, go, isPrimary } = store
  const [weekOffset, setWeekOffset] = useState(0)
  const [selected, setSelected] = useState(null)
  const [steps, setSteps] = useState({})
  const [limit, setLimit] = useState(null)
  const [slotsOpen, setSlotsOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t) }, [])

  const images = byId(doc.images)
  const labels = useMemo(() => new Map(doc.posts.map((p, i) => [p.id, postLabelAt(doc.posts, i)])), [doc.posts])
  const today = istDateKey()
  const start = addDays(mondayOf(today), weekOffset * 7)
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i))
  const byDay = useMemo(() => {
    const m = new Map()
    for (const p of doc.posts) {
      const at = isPublished(p) ? p.publish.publishedAt : p.schedule?.at
      if (!at) continue
      const k = istDateKey(at)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push({ p, at })
    }
    for (const list of m.values()) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    return m
  }, [doc.posts])

  const queue = unscheduled(doc.posts)
  const notApproved = doc.posts.filter((p) => !p.approved && !isPublished(p) && (p.slides.length || p.design?.exportImageId)).length
  const outOfOrder = new Set(orderProblems(doc.posts))
  const slots = doc.scheduleSlots
  const best = useMemo(() => suggestedSlots(measureRows(doc)), [doc])
  const canPublish = metaConfigured(settings) && cloudinaryConfigured(settings)
  const sel = doc.posts.find((p) => p.id === selected) || null

  const setTime = (id, at) => update((d) => ({
    ...d,
    posts: d.posts.map((p) => (p.id === id ? { ...p, schedule: { ...p.schedule, at }, publish: { ...p.publish, error: null } } : p)),
  }))
  const setSlots = (patch) => update((d) => ({ ...d, scheduleSlots: { ...d.scheduleSlots, ...patch } }))

  const dropOn = (dayKey) => (e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('over')
    const id = e.dataTransfer.getData(DRAG_SCHEDULE)
    const post = doc.posts.find((p) => p.id === id)
    if (!post || isPublished(post)) return
    const prev = post.schedule?.at ? istParts(post.schedule.at) : null
    const at = istAt(dayKey, prev?.hour ?? slots.hour, prev?.minute ?? slots.minute ?? 0)
    if (Date.parse(at) < Date.now()) {
      toast('That time has already passed — pick a later day.', { kind: 'error' })
      return
    }
    if (!post.approved) toast(`${labels.get(id)} is not approved yet — it won't publish until it is.`, { kind: 'info', action: { label: 'Review', fn: () => go('review') } })
    setTime(id, at)
    setSelected(id)
  }

  const fill = () => {
    const plan = autoSchedule(doc.posts, slots)
    const n = Object.keys(plan).length
    if (!n) {
      toast(queue.length ? 'No open slots in the next year — add more posting days.' : 'Nothing approved is waiting for a time.', { kind: 'info' })
      return
    }
    const before = Object.fromEntries(Object.keys(plan).map((id) => [id, '']))
    update((d) => ({ ...d, posts: d.posts.map((p) => (plan[p.id] ? { ...p, schedule: { ...p.schedule, at: plan[p.id] } } : p)) }))
    toast(`${n} post${n > 1 ? 's' : ''} scheduled${n < queue.length ? ` · ${queue.length - n} still waiting` : ''}`, {
      kind: 'success',
      action: { label: 'Undo', fn: () => update((d) => ({ ...d, posts: d.posts.map((p) => (p.id in before ? { ...p, schedule: { ...p.schedule, at: '' } } : p)) })) },
    })
  }

  const publish = async (post) => {
    const label = labels.get(post.id)
    if (!(await confirmAction(`Publish ${label} to Instagram now? It will be public straight away.`, { ok: 'Publish now' }))) return
    setSteps((s) => ({ ...s, [post.id]: 'Starting…' }))
    await publishNow(store, post.id, { onStep: (text) => setSteps((s) => ({ ...s, [post.id]: text })) })
    setSteps((s) => { const { [post.id]: _, ...rest } = s; return rest })
  }

  const checkLimit = async () => {
    try {
      setLimit(await publishingLimit(settings.igAccountId))
    } catch (err) {
      toast(err instanceof MetaError ? err.message : errorMessage(err), { kind: 'error' })
    }
  }

  const exportIcs = () => {
    const n = doc.posts.filter((p) => p.schedule?.at).length
    if (!n) return toast('Nothing scheduled yet.', { kind: 'info' })
    downloadText(buildIcs(doc), 'kss-schedule.ics', 'text/calendar;charset=utf-8')
    toast(`${n} post${n > 1 ? 's' : ''} exported — open the file to add them to your calendar.`, { kind: 'success' })
  }

  return (
    <div className="schedule">
      {!canPublish && (
        <div className="banner warn">
          <Icon name="key" size={14} />
          <span>{!metaConfigured(settings) ? 'Connect Instagram' : 'Connect Cloudinary (image hosting)'} in Settings to publish. You can still plan the calendar.</span>
          <Btn size="sm" kind="ghost" onClick={() => go('settings')}>Settings</Btn>
        </div>
      )}
      <div className="banner info">
        <Icon name="info" size={14} />
        <span>Scheduled posts publish only while KSS Studio is open in {isPrimary ? 'this tab' : 'its main tab'}. Export the calendar file as a reminder in case the laptop is closed.</span>
      </div>

      <div className="toolbar">
        <IconBtn icon="left" label="Previous two weeks" onClick={() => setWeekOffset(weekOffset - 2)} />
        <Btn size="sm" kind="ghost" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>Today</Btn>
        <IconBtn icon="right" label="Next two weeks" onClick={() => setWeekOffset(weekOffset + 2)} />
        <span className="toolbar-title">{formatIst(`${days[0]}T12:00:00+05:30`, { day: 'numeric', month: 'short' })} – {formatIst(`${days[13]}T12:00:00+05:30`, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <span className="spacer" />
        <Btn size="sm" kind="ghost" icon="clock" onClick={() => setSlotsOpen(true)} tip="Which days and time Auto-fill uses">
          {slots.weekdays.map((d) => WEEKDAYS[d]).join(' ') || 'No days'} · {hourLabel(slots.hour)}
        </Btn>
        <Btn size="sm" kind="primary" icon="calendar" onClick={fill} disabled={!queue.length} tip="Put every approved post into the next open slots, oldest grid post first">Auto-fill {queue.length || ''}</Btn>
        <Btn size="sm" kind="ghost" icon="download" onClick={exportIcs} tip="Download an .ics file for Google or Apple Calendar">Calendar file</Btn>
        {metaConfigured(settings) && (
          <Btn size="sm" kind="ghost" icon="info" onClick={checkLimit} tip="Instagram allows a limited number of API posts per 24 hours">
            {limit ? `${limit.used} / ${limit.total} today` : 'Daily limit'}
          </Btn>
        )}
      </div>

      <div className="schedule-body">
        <div className="calendar">
          {WEEKDAYS.slice(1).concat(WEEKDAYS[0]).map((w) => <div key={w} className="cal-dow label">{w}</div>)}
          {days.map((k) => {
            const list = byDay.get(k) || []
            const past = k < today
            const slotDay = slots.weekdays.includes(weekdayOf(k))
            return (
              <div
                key={k}
                className={`cal-day ${k === today ? 'today' : ''} ${past ? 'past' : ''} ${slotDay && !past ? 'slot-day' : ''}`}
                onDragOver={(e) => { if (!past && hasDrag(e, DRAG_SCHEDULE)) { e.preventDefault(); e.currentTarget.classList.add('over') } }}
                onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                onDrop={past ? undefined : dropOn(k)}
              >
                <span className="cal-date">{Number(k.slice(8))}{k.slice(8) === '01' || k === days[0] ? ` ${formatIst(`${k}T12:00:00+05:30`, { month: 'short' })}` : ''}</span>
                {list.map(({ p, at }) => {
                  const status = slotStatus(p, { publishing: isPublishing(p.id) })
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`cal-post ${status} ${selected === p.id ? 'on' : ''} ${outOfOrder.has(p.id) ? 'order' : ''}`}
                      draggable={!isPublished(p)}
                      onDragStart={(e) => { e.dataTransfer.setData(DRAG_SCHEDULE, p.id); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => setSelected(p.id)}
                      title={`${labels.get(p.id)} · ${STATUS_LABEL[status]}`}
                    >
                      <Thumb image={images.get(coverImageId(p))} />
                      <span className="cal-post-text">
                        <strong>{labels.get(p.id)}</strong>
                        <span>{formatIstTime(at)}</span>
                      </span>
                      <span className={`state-dot ${status}`} />
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        <aside className="schedule-side">
          {sel ? (
            <SlotPanel
              post={sel}
              label={labels.get(sel.id)}
              image={images.get(coverImageId(sel))}
              step={steps[sel.id]}
              canPublish={canPublish}
              outOfOrder={outOfOrder.has(sel.id)}
              onClose={() => setSelected(null)}
              onTime={(at) => setTime(sel.id, at)}
              onPublish={() => publish(sel)}
              onRetry={() => clearPublishError(store, sel.id)}
              onPreview={() => setPreview(sel)}
            />
          ) : (
            <>
              <div className="side-head">
                <span className="label">Ready to schedule</span>
                <span className="count">{queue.length}</span>
              </div>
              {queue.length ? (
                <div className="queue">
                  {queue.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="queue-item"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData(DRAG_SCHEDULE, p.id); e.dataTransfer.effectAllowed = 'move' }}
                      onClick={() => setSelected(p.id)}
                    >
                      <Thumb image={images.get(coverImageId(p))} />
                      <span className="cal-post-text"><strong>{labels.get(p.id)}</strong><span>{formatLabel(p.format)}</span></span>
                      <Icon name="drag" size={14} />
                    </button>
                  ))}
                  <p className="field-hint">Drag onto a day, or use Auto-fill. The oldest grid post goes first.</p>
                </div>
              ) : (
                <Empty icon="calendar" title="Nothing waiting">Approved posts without a time show up here.</Empty>
              )}
              {notApproved > 0 && (
                <p className="field-hint pad">
                  {notApproved} post{notApproved > 1 ? 's are' : ' is'} not approved yet. <button type="button" className="link-btn" onClick={() => go('review')}>Review</button>
                </p>
              )}
              {outOfOrder.size > 0 && (
                <div className="banner warn inline">
                  <Icon name="warning" size={14} />
                  <span>{outOfOrder.size} post{outOfOrder.size > 1 ? 's' : ''} will publish before an older grid post, so the grid will look different from the plan.</span>
                </div>
              )}
              {best && (
                <div className="card soft">
                  <span className="label">Best times so far</span>
                  <p>{best.weekdays.map((d) => WEEKDAYS[d]).join(', ')} around {hourLabel(best.hour)} — from {best.basis} measured posts.</p>
                  <Btn size="sm" kind="ghost" onClick={() => setSlots({ weekdays: best.weekdays, hour: best.hour, minute: 0 })}>Use these slots</Btn>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {slotsOpen && <SlotsModal slots={slots} best={best} onChange={setSlots} onClose={() => setSlotsOpen(false)} />}
      {preview && <CarouselModal post={preview} label={labels.get(preview.id)} onClose={() => setPreview(null)} />}
    </div>
  )
}

function Thumb({ image }) {
  return <span className="mini-thumb"><Frame image={image} aspect="1:1" /></span>
}

function SlotPanel({ post, label, image, step, canPublish, outOfOrder, onClose, onTime, onPublish, onRetry, onPreview }) {
  const { go } = useStore()
  const status = slotStatus(post, { publishing: isPublishing(post.id) || !!step })
  const live = isPublished(post)
  const slides = publishImageIds(post).length
  return (
    <div className="slot-panel">
      <div className="panel-head">
        <strong>{label}</strong>
        <span className="mute">{formatLabel(post.format)}{slides > 1 ? ` · ${slides} slides` : ''}</span>
        <span className={`stage-chip ${status}`}>{STATUS_LABEL[status]}</span>
        <span className="spacer" />
        <IconBtn icon="x" label="Close" onClick={onClose} />
      </div>
      <button type="button" className="slot-frame" onClick={onPreview} aria-label="Preview post">
        <Frame image={image} crop={post.design?.exportImageId ? null : post.slides[0]?.crop} aspect={post.aspect} full />
      </button>
      {post.caption?.text && <p className="review-caption">{post.caption.text}</p>}

      {live ? (
        <>
          <p className="check-ok"><Icon name="check" size={13} /> Published {relativeTime(post.publish.publishedAt)}</p>
          {post.publish.permalink && <a className="btn ghost sm" href={post.publish.permalink} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> View on Instagram</a>}
          <Btn size="sm" kind="ghost" icon="chart" onClick={() => go('measure')}>See performance</Btn>
        </>
      ) : (
        <>
          <Field label="Publish at (IST)">
            <input type="datetime-local" value={toIstLocalInput(post.schedule?.at)} onChange={(e) => onTime(fromIstLocalInput(e.target.value))} disabled={!!step} />
          </Field>
          {post.schedule?.at && <p className="field-hint">{formatIst(post.schedule.at, { dateStyle: 'full', timeStyle: 'short' })} · {relativeTime(post.schedule.at)}</p>}
          {!post.approved && (
            <div className="banner warn inline">
              <Icon name="warning" size={14} /><span>Not approved — it won't publish.</span>
              <Btn size="sm" kind="ghost" onClick={() => go('review')}>Review</Btn>
            </div>
          )}
          {outOfOrder && <p className="warn-text">A newer grid post is scheduled before this one.</p>}
          {post.publish?.error && (
            <div className="banner error inline">
              <Icon name="warning" size={14} /><span>{post.publish.error}</span>
              <Btn size="sm" kind="ghost" onClick={onRetry} tip="Clears the error so the scheduler tries again at the set time">Retry</Btn>
            </div>
          )}
          {step && <p className="status-line"><Icon name="send" size={13} /> {step}</p>}
          <div className="row wrap">
            <Btn kind="primary" icon="send" busy={!!step} disabled={!canPublish || !post.approved || !!post.publish?.startedAt} onClick={onPublish}
              tip={!canPublish ? 'Connect Instagram and Cloudinary in Settings' : !post.approved ? 'Approve it in Review first' : 'Post it to Instagram right now'}>
              Publish now
            </Btn>
            {post.schedule?.at && <Btn kind="ghost" icon="x" onClick={() => onTime('')} disabled={!!step}>Unschedule</Btn>}
            <Btn kind="ghost" icon="write" onClick={() => go('write', { postId: post.id })}>Caption</Btn>
          </div>
        </>
      )}
    </div>
  )
}

function SlotsModal({ slots, best, onChange, onClose }) {
  const toggle = (d) => onChange({ weekdays: slots.weekdays.includes(d) ? slots.weekdays.filter((x) => x !== d) : [...slots.weekdays, d].sort((a, b) => a - b) })
  return (
    <Modal title="Posting slots" onClose={onClose} width={440} footer={<Btn kind="primary" onClick={onClose}>Done</Btn>}>
      <Field label="Days" group>
        <div className="chips">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} type="button" className={`chip ${slots.weekdays.includes(d) ? 'on' : ''}`} onClick={() => toggle(d)} aria-pressed={slots.weekdays.includes(d)}>{WEEKDAYS[d]}</button>
          ))}
        </div>
      </Field>
      <Field label="Time (IST)">
        <select value={slots.hour} onChange={(e) => onChange({ hour: Number(e.target.value), minute: 0 })}>
          {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
        </select>
      </Field>
      <p className="field-hint">
        {best
          ? `Your measured posts do best on ${best.weekdays.map((d) => WEEKDAYS[d]).join(', ')} around ${hourLabel(best.hour)}.`
          : 'Once 8 or more posts have insights, the best days and hour for your audience show up here.'}
      </p>
    </Modal>
  )
}
