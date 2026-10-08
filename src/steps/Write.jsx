// Write: captions, hashtags and the first comment for every post in the plan.
import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Btn, IconBtn, Field, Empty, Segmented, Frame, CopyBtn, useRunner } from '../components/ui.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import {
  byId, postLabelAt, coverImageId, isPublished, formatLabel, hashtagCount, captionForPublish,
  firstCommentForPublish, CAPTION_LIMIT, MAX_HASHTAGS,
} from '../data/model.js'
import { generateCaption, refineCaption, openers, hashtags, rememberCaption } from '../lib/studio.js'
import { VOICE_OPTIONS } from '../lib/prompts.js'
import { wait } from '../lib/download.js'

const FOLD = 125 // roughly where Instagram cuts the caption with “more”
const FILTERS = [['todo', 'To write'], ['draft', 'Drafts'], ['approved', 'Approved'], ['all', 'All']]

const captionState = (p) => (p.caption.approved ? 'approved' : p.caption.text.trim() ? 'draft' : 'todo')

export default function Write() {
  const { doc, update, getDoc, settings, toast, go, route } = useStore()
  const { busy, run, cancel } = useRunner()
  const [filter, setFilter] = useState('all')
  const [postId, setPostId] = useState(route.params?.postId || null)
  const [refineText, setRefineText] = useState('')
  const [options, setOptions] = useState([])
  const [batch, setBatch] = useState(null)
  useEffect(() => { if (route.params?.postId) setPostId(route.params.postId) }, [route.params?.postId])

  const images = byId(doc.images)
  const rows = useMemo(() => doc.posts.map((p, i) => ({ p, i, label: postLabelAt(doc.posts, i) })).filter(({ p }) => p.slides.length || p.design?.exportImageId), [doc.posts])
  const shown = rows.filter(({ p }) => filter === 'all' || captionState(p) === filter)
  const current = rows.find(({ p }) => p.id === postId) || shown[0] || rows[0]
  const post = current?.p
  const counts = Object.fromEntries(FILTERS.map(([id]) => [id, id === 'all' ? rows.length : rows.filter(({ p }) => captionState(p) === id).length]))

  useEffect(() => { setOptions([]); setRefineText('') }, [post?.id])

  const patchCaption = (id, patch) => update((d) => ({
    ...d,
    posts: d.posts.map((p) => (p.id === id ? { ...p, caption: { ...p.caption, ...patch, ...(patch.approved === undefined && ('text' in patch || 'hashtags' in patch || 'firstComment' in patch) ? { approved: false } : {}) } } : p)),
  }))
  const latest = (id) => getDoc().posts.find((p) => p.id === id)

  const runGenerate = async () => {
    const text = await run('generate', (signal) => generateCaption(getDoc(), latest(post.id), { handle: settings.handle, signal }))
    if (text) patchCaption(post.id, { text: text.trim() })
  }
  const runRefine = async (e) => {
    e?.preventDefault()
    const text = await run('refine', (signal) => refineCaption(getDoc(), latest(post.id), refineText.trim(), { handle: settings.handle, signal }))
    if (!text) return
    patchCaption(post.id, { text: text.trim() })
    setRefineText('')
  }
  const runOpeners = async () => {
    const list = await run('openers', (signal) => openers(getDoc(), latest(post.id), { signal }))
    if (list) setOptions(list)
  }
  const pickOpener = (line) => {
    const [, ...rest] = post.caption.text.split('\n')
    patchCaption(post.id, { text: [line, ...rest].join('\n') })
    setOptions([])
  }
  const runHashtags = async () => {
    const tags = await run('tags', (signal) => hashtags(getDoc(), latest(post.id), { signal }))
    if (tags != null) patchCaption(post.id, { hashtags: tags })
  }

  const approve = (p, on = true) => {
    update((d) => {
      const fresh = d.posts.find((x) => x.id === p.id)
      const caption = { ...fresh.caption, approved: on, briefVersion: on ? d.brief.version : fresh.caption.briefVersion }
      const next = { ...fresh, caption }
      return {
        ...d,
        captionMemory: on ? rememberCaption(d, next) : d.captionMemory,
        posts: d.posts.map((x) => (x.id === p.id ? next : x)),
      }
    })
    if (on) {
      const nextTodo = rows.find(({ p: x }) => x.id !== p.id && captionState(x) !== 'approved')
      if (nextTodo) setPostId(nextTodo.p.id)
      else toast('Every caption approved', { kind: 'success', action: { label: 'Review', fn: () => go('review') } })
    }
  }

  const generateAll = async () => {
    const todo = rows.filter(({ p }) => !p.caption.text.trim() && !isPublished(p))
    if (!todo.length) {
      toast('Every post already has a caption.', { kind: 'info' })
      return
    }
    let failed = 0
    await run('all', async (signal) => {
      for (let i = 0; i < todo.length; i++) {
        if (signal.aborted) break
        setBatch(`${i + 1} of ${todo.length}`)
        setPostId(todo[i].p.id)
        try {
          const text = await generateCaption(getDoc(), latest(todo[i].p.id), { handle: settings.handle, signal })
          patchCaption(todo[i].p.id, { text: text.trim() })
        } catch (err) {
          if (err?.name === 'AbortError') throw err
          failed++
        }
        if (i < todo.length - 1) await wait(500)
      }
    })
    setBatch(null)
    toast(failed ? `Captions written — ${failed} failed, try those again.` : 'Captions written. Read each one, then approve.', { kind: failed ? 'error' : 'success' })
  }

  if (!rows.length) {
    return (
      <Empty icon="write" title="Nothing to write yet" action={<Btn kind="primary" icon="grid" onClick={() => go('plan')}>Go to Plan</Btn>}>
        Captions are written for posts in the plan.
      </Empty>
    )
  }

  const c = post.caption
  const tagCount = hashtagCount(c)
  const live = isPublished(post)
  const stale = c.approved && c.briefVersion && c.briefVersion < doc.brief.version
  const firstLine = c.text.split('\n')[0] || ''
  const folded = c.text.trim().slice(0, FOLD).split('\n')[0]

  return (
    <div className="write">
      <aside className="write-list" aria-label="Posts">
        <div className="pool-tabs">
          {FILTERS.map(([id, l]) => (
            <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{l} <span className="count">{counts[id]}</span></button>
          ))}
        </div>
        <div className="write-actions">
          {busy === 'all'
            ? <><span className="status-line"><span className="spinner" /> Writing {batch}</span><Btn size="sm" kind="ghost" onClick={cancel}>Stop</Btn></>
            : <Btn size="sm" kind="ghost" icon="sparkle" onClick={generateAll} disabled={!!busy || !counts.todo}>Write all empty ({counts.todo})</Btn>}
        </div>
        <div className="write-rows">
          {shown.map(({ p, label }) => {
            const st = captionState(p)
            return (
              <button key={p.id} type="button" className={`write-row ${p.id === post.id ? 'on' : ''}`} onClick={() => setPostId(p.id)}>
                <Frame image={images.get(coverImageId(p))} crop={p.design?.exportImageId ? null : p.slides[0]?.crop} aspect="4:5" className="write-thumb" />
                <span className="write-row-text">
                  <strong>{label} <span className="mute">· {formatLabel(p.format)}</span></strong>
                  <span className="small-text mute">{p.caption.text.split('\n')[0]?.slice(0, 60) || 'No caption yet'}</span>
                </span>
                <span className={`state-dot ${st}`} title={st === 'approved' ? 'Approved' : st === 'draft' ? 'Draft' : 'To write'} />
              </button>
            )
          })}
          {!shown.length && <p className="field-hint pad">Nothing in this list.</p>}
        </div>
        <Field label="Notes for every caption" hint="Claude follows these for every post: “mention the Mumbai studio”, “no rhetorical questions”.">
          <textarea rows={3} value={doc.captionNotes} onChange={(e) => update((d) => ({ ...d, captionNotes: e.target.value }))} />
        </Field>
      </aside>

      <section className="write-editor" aria-label={`Caption for ${current.label}`}>
        <header className="panel-head">
          <h3>{current.label} <span className="mute">· {formatLabel(post.format)}{post.pillar ? ` · ${post.pillar}` : ''}</span></h3>
          <div className="row">
            <IconBtn icon="grid" label="Open in Plan" onClick={() => go('plan', { postId: post.id })} />
            {c.approved
              ? <Btn size="sm" kind="ghost" icon="undo" onClick={() => approve(post, false)}>Unapprove</Btn>
              : <Btn size="sm" kind="primary" icon="check" onClick={() => approve(post)} disabled={!c.text.trim() || c.text.length > CAPTION_LIMIT || tagCount > MAX_HASHTAGS}>Approve</Btn>}
          </div>
        </header>
        {live && <div className="banner inline"><Icon name="info" size={14} /><span>Already posted. Edits here won’t change Instagram, but they help Claude learn your voice.</span></div>}
        {stale && <div className="banner warn inline"><Icon name="warning" size={14} /><span>The brief changed after this was approved. Give it another read.</span></div>}

        <Field label="Voice" group>
          <Segmented size="sm" value={c.voice} onChange={(v) => patchCaption(post.id, { voice: v })} options={VOICE_OPTIONS.map((v) => [v.id, v.label, v.desc])} />
        </Field>

        <Field
          label="Caption"
          counter={<span className={c.text.length > CAPTION_LIMIT ? 'warn-text small-text' : 'mute small-text'}>{c.text.length} / {CAPTION_LIMIT}</span>}
        >
          <textarea className="caption-box" rows={10} value={c.text} onChange={(e) => patchCaption(post.id, { text: e.target.value })} placeholder="Write it yourself, or let Claude draft it from the photo, the brief and the theme." />
        </Field>

        <div className="row wrap">
          <Btn kind={c.text ? 'ghost' : 'primary'} icon="sparkle" onClick={runGenerate} busy={busy === 'generate'} disabled={!!busy && busy !== 'generate'}>{c.text ? 'Write again' : 'Write caption'}</Btn>
          <Btn kind="ghost" icon="refresh" onClick={runOpeners} busy={busy === 'openers'} disabled={!c.text.trim() || (!!busy && busy !== 'openers')} tip="Three other first lines — the line people see before “more”">Try other openers</Btn>
          <CopyBtn text={[captionForPublish(c), firstCommentForPublish(c)].filter(Boolean).join('\n\n')} label="Copy all" />
        </div>
        {options.length > 0 && (
          <div className="opener-list">
            {options.map((o) => (
              <button key={o} type="button" className="opener" onClick={() => pickOpener(o)}><Icon name="arrowRight" size={12} /> {o}</button>
            ))}
          </div>
        )}

        <form className="refine-bar" onSubmit={runRefine}>
          <Icon name="sparkle" size={14} />
          <input value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder="Change it: “shorter”, “end with a question”, “less formal”" disabled={!c.text.trim() || busy === 'refine'} aria-label="Refine the caption" />
          {busy === 'refine' ? <Btn size="sm" kind="ghost" onClick={cancel}>Stop</Btn> : <Btn size="sm" kind="ghost" type="submit" disabled={!c.text.trim()}>Refine</Btn>}
        </form>

        <div className="form-grid">
          <Field
            label="Hashtags"
            counter={<span className={tagCount > MAX_HASHTAGS ? 'warn-text small-text' : 'mute small-text'}>{tagCount} / {MAX_HASHTAGS}</span>}
            hint={tagCount > MAX_HASHTAGS ? `Instagram allows ${MAX_HASHTAGS}, counting any in the caption.` : 'Instagram now allows 5. Pick specific ones over big ones.'}
          >
            <div className="row">
              <input value={c.hashtags} onChange={(e) => patchCaption(post.id, { hashtags: e.target.value })} placeholder="#example #another" />
              <IconBtn icon="sparkle" label="Suggest hashtags" onClick={runHashtags} disabled={!!busy} />
            </div>
          </Field>
          <Field label="Put hashtags in" group>
            <Segmented size="sm" value={c.hashtagMode} onChange={(v) => patchCaption(post.id, { hashtagMode: v })} options={[['comment', 'First comment'], ['caption', 'Caption']]} />
          </Field>
        </div>
        <Field label="First comment" hint="Posted as a comment straight after publishing.">
          <textarea rows={2} value={c.firstComment} onChange={(e) => patchCaption(post.id, { firstComment: e.target.value })} />
        </Field>
        <Field label="Notes for this caption">
          <input value={c.notes} onChange={(e) => patchCaption(post.id, { notes: e.target.value })} placeholder="“Credit the stylist”, “mention the launch date”" />
        </Field>
      </section>

      <aside className="write-preview" aria-label="Preview">
        <span className="label">As it shows in the feed</span>
        <div className="ig-card">
          <div className="ig-head"><span className="ig-avatar" /> <strong>{(settings.handle || '').replace(/^@/, '') || 'studio'}</strong></div>
          <Frame image={images.get(coverImageId(post))} crop={post.design?.exportImageId ? null : post.slides[0]?.crop} aspect={post.aspect} full />
          <div className="ig-caption">
            <strong>{(settings.handle || '').replace(/^@/, '') || 'studio'}</strong>{' '}
            {folded ? <>{folded}{folded.length < c.text.trim().length && <span className="mute">… more</span>}</> : <span className="mute">No caption yet</span>}
          </div>
        </div>
        <p className="field-hint">
          {firstLine.length > FOLD ? 'The first line runs past the fold — the hook gets cut.' : firstLine ? `The hook is ${firstLine.length} characters — it shows in full.` : 'The first line is the hook. Make it earn the tap.'}
        </p>
      </aside>
    </div>
  )
}
