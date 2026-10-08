// Small building blocks shared by every step screen.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import Tip from './Tip.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { fullUrl, cachedFullUrl } from '../data/media.js'
import { cropBackground, ASPECTS } from '../data/model.js'

export function Btn({ icon, children, kind = '', size = '', tip, busy, className = '', ...rest }) {
  const btn = (
    <button type="button" className={`btn ${kind} ${size} ${className}`} {...rest} disabled={!!busy || rest.disabled}>
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} /> : null}
      {children && <span>{children}</span>}
    </button>
  )
  return tip ? <Tip text={tip}>{btn}</Tip> : btn
}

export function IconBtn({ icon, label, active, className = '', size = 15, ...rest }) {
  return (
    <Tip text={label}>
      <button type="button" aria-label={label} className={`icon-btn ${active ? 'active' : ''} ${className}`} {...rest}>
        <Icon name={icon} size={size} />
      </button>
    </Tip>
  )
}

export const Spinner = ({ size = 14 }) => <span className="spinner" style={{ width: size, height: size }} aria-label="Working" />

// `group` renders a div: use it when the field holds buttons (chips, swatches), so clicking
// the label text doesn't press the first button.
export function Field({ label, hint, children, counter, className = '', group = false }) {
  const Tag = group ? 'div' : 'label'
  return (
    <Tag className={`field ${className}`}>
      {(label || counter) && (
        <span className="field-head">
          {label && <span className="label">{label}</span>}
          {counter}
        </span>
      )}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </Tag>
  )
}

export function Empty({ icon = 'image', title, children, action }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} strokeWidth={1.2} />
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Segmented({ value, options, onChange, size = '' }) {
  return (
    <div className={`segmented ${size}`} role="radiogroup">
      {options.map((o) => {
        const [id, label, tip] = Array.isArray(o) ? o : [o, o]
        const b = (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
            {label}
          </button>
        )
        return tip ? <Tip key={id} text={tip}>{b}</Tip> : b
      })}
    </div>
  )
}

export function Chips({ options, value = [], onChange, max }) {
  const set = new Set(value)
  const toggle = (id) => {
    if (set.has(id)) onChange(value.filter((v) => v !== id))
    else if (!max || value.length < max) onChange([...value, id])
  }
  return (
    <div className="chips">
      {options.map((o) => {
        const [id, label] = Array.isArray(o) ? o : typeof o === 'object' ? [o.id ?? o.name, o.label ?? o.name] : [o, o]
        return (
          <button key={id} type="button" className={`chip ${set.has(id) ? 'on' : ''}`} onClick={() => toggle(id)}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

export function CopyBtn({ text, label = 'Copy', size = 'sm' }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1400)
    } catch {
      // Clipboard blocked: nothing to do.
    }
  }
  return <Btn icon={done ? 'check' : 'copy'} size={size} kind="ghost" onClick={copy} disabled={!text}>{done ? 'Copied' : label}</Btn>
}

export function Meter({ value, tone }) {
  const v = Math.max(0, Math.min(100, value || 0))
  return <div className={`meter ${tone || (v < 50 ? 'warn' : 'ok')}`}><span style={{ width: `${v}%` }} /></div>
}

export function Modal({ title, onClose, children, footer, width = 560, className = '' }) {
  const ref = useRef(null)
  // onClose is usually an inline arrow; keep it in a ref so a re-render doesn't re-run the
  // effect and pull focus away from an input inside the modal.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close.current?.() }
    window.addEventListener('keydown', onKey)
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`modal ${className}`} style={{ width }} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

export function Toasts() {
  const { toasts, dismissToast } = useStore()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === 'error' ? 'warning' : t.kind === 'success' ? 'check' : 'info'} size={14} />
          <span>{t.message}</span>
          {t.action && <button type="button" className="toast-action" onClick={() => { t.action.fn(); dismissToast(t.id) }}>{t.action.label}</button>}
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><Icon name="x" size={12} /></button>
        </div>
      ))}
    </div>
  )
}

// Full-size object URL for an image, loaded on demand.
export function useFullUrl(id) {
  const [url, setUrl] = useState(() => (id ? cachedFullUrl(id) : null))
  useEffect(() => {
    let alive = true
    if (!id) {
      setUrl(null)
      return undefined
    }
    const cached = cachedFullUrl(id)
    if (cached) setUrl(cached)
    else fullUrl(id).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [id])
  return url
}

// An image cropped to a frame. `full` loads the full-size file once it's ready.
export function Frame({ image, crop, aspect = '4:5', full = false, className = '', children, style, ...rest }) {
  const { thumbs } = useStore()
  const big = useFullUrl(full ? image?.id : null)
  const url = big || (image ? thumbs[image.id] : null)
  const a = typeof aspect === 'number' ? aspect : ASPECTS[aspect] || 0.8
  const bg = image ? cropBackground(url, image.width, image.height, a, crop) : {}
  return (
    <div className={`frame ${url ? '' : 'loading'} ${className}`} style={{ aspectRatio: a, ...bg, ...style }} {...rest}>
      {children}
    </div>
  )
}

// In-app confirmation. window.confirm is silently answered "no" in embedded and some
// locked-down browsers, which made every delete quietly do nothing.
let showConfirm = null
export function confirmAction(message, { ok = 'Continue', danger = false } = {}) {
  // eslint-disable-next-line no-alert
  if (!showConfirm) return Promise.resolve(window.confirm(message))
  return new Promise((resolve) => showConfirm({ message, ok, danger, resolve }))
}

export function ConfirmHost() {
  const [ask, setAsk] = useState(null)
  const okRef = useRef(null)
  useEffect(() => {
    showConfirm = (next) => setAsk((prev) => { prev?.resolve(false); return next })
    return () => { showConfirm = null }
  }, [])
  useEffect(() => { if (ask) okRef.current?.focus() }, [ask])
  if (!ask) return null
  const answer = (yes) => { ask.resolve(yes); setAsk(null) }
  return (
    <Modal
      title="Are you sure?"
      width={440}
      onClose={() => answer(false)}
      footer={(
        <>
          <Btn kind="ghost" onClick={() => answer(false)}>Cancel</Btn>
          <button type="button" ref={okRef} className={`btn ${ask.danger ? 'danger' : 'primary'}`} onClick={() => answer(true)}><span>{ask.ok}</span></button>
        </>
      )}
    >
      <p>{ask.message}</p>
    </Modal>
  )
}

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// Progress for long jobs. With a total it fills and estimates the time left; without one it
// sweeps. The elapsed clock keeps ticking, so a slow job never looks frozen.
export function ProgressBar({ label, done = 0, total = 0, failed = 0, startedAt, onStop, className = '' }) {
  const [now, setNow] = useState(Date.now())
  const [lastMove, setLastMove] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { setLastMove(Date.now()) }, [done, failed])
  const finished = done + failed
  const pct = total ? Math.min(100, (finished / total) * 100) : 0
  const elapsed = startedAt ? now - startedAt : 0
  const left = total && finished ? (elapsed / finished) * (total - finished) : null
  const quiet = now - lastMove
  return (
    <div className={`progress ${className}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total || undefined} aria-valuenow={total ? finished : undefined}>
      <div className="progress-head">
        <span className="spinner" />
        <strong>{label}</strong>
        {total > 0 && <span className="progress-count">{finished} of {total}</span>}
        {failed > 0 && <span className="progress-failed">{failed} failed</span>}
        <span className="grow" />
        <span className="progress-time">
          {clock(elapsed)}
          {left !== null && finished < total ? ` · about ${clock(left)} left` : total && !finished ? ' · starting' : ''}
        </span>
        {onStop && <Btn size="sm" kind="ghost" icon="x" onClick={onStop}>Stop</Btn>}
      </div>
      <div className={`progress-track ${total ? '' : 'sweep'}`}><span style={total ? { width: `${Math.max(pct, 2)}%` } : undefined} /></div>
      {quiet > 30000 && <p className="progress-note">Still working. The last answer came {clock(quiet)} ago; big photos or a busy model can take a while.</p>}
    </div>
  )
}

// One Claude job at a time per screen: `busy` names the running job, errors become toasts.
export function useRunner() {
  const { toast } = useStore()
  const job = useAbortable()
  const [busy, setBusy] = useState(null)
  const run = async (key, fn) => {
    setBusy(key)
    try {
      return await fn(job.start())
    } catch (err) {
      if (err?.name !== 'AbortError') toast(err?.message || 'Something went wrong.', { kind: 'error' })
      return undefined
    } finally {
      setBusy((b) => (b === key ? null : b))
    }
  }
  const cancel = () => { job.cancel(); setBusy(null) }
  return { busy, run, cancel }
}

export function useAbortable() {
  const ref = useRef(null)
  useEffect(() => () => ref.current?.abort(), [])
  return {
    start() {
      ref.current?.abort()
      ref.current = new AbortController()
      return ref.current.signal
    },
    cancel() { ref.current?.abort(); ref.current = null },
  }
}
