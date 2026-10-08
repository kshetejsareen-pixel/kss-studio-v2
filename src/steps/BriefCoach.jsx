// The brief coach: tap-to-add suggestions under every field, a goal picker, a competitor
// finder and a one-question-at-a-time interview, so nobody is left staring at a blank box.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Btn, IconBtn, Chips, Meter, Modal, useAbortable, useRunner } from '../components/ui.jsx'
import { useConnections } from '../components/shell.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { briefCompleteness } from '../lib/brief.js'
import { briefIdeas, findCompetitors } from '../lib/studio.js'
import { errorMessage } from '../lib/api.js'
import { INDIA_CITIES } from '../lib/prompts.js'
import { uid } from '../lib/ids.js'
import {
  GOAL_GROUPS, GOAL_PRESETS, CATEGORIES, VOICE_PAIRS, AGE_BANDS,
  offlineIdeas, categoryFor, hasItem, toggleItem, handlesOf,
} from '../lib/coach.js'

const GENDERS = ['Women', 'Men', 'All genders']
const now = () => new Date().toISOString()
const norm = (s) => String(s || '').trim().toLowerCase()

export function useSetBrief() {
  const { update } = useStore()
  return (patch) => update((d) => ({ ...d, brief: { ...d.brief, ...(typeof patch === 'function' ? patch(d.brief) : patch), updatedAt: now() } }))
}

// ---- Suggestions -------------------------------------------------------------------------------

// Instant ideas from the category and goals, plus Claude's tailored ideas once the brand and
// offer are known. Claude re-runs on its own a moment after those inputs stop changing.
export function useBriefIdeas() {
  const { doc, update } = useStore()
  const claudeOk = useConnections().claude.tone === 'ok'
  const b = doc.brief
  const stored = doc.briefIdeas
  const key = [b.client, b.offer, b.category, (b.goals || []).join('|'), b.target].map(norm).join('§')
  const [state, setState] = useState({ busy: false, error: '' })
  const job = useAbortable()
  const latest = useRef(b)
  latest.current = b
  const tried = useRef(null)

  const refresh = async () => {
    const brief = latest.current
    const forKey = [brief.client, brief.offer, brief.category, (brief.goals || []).join('|'), brief.target].map(norm).join('§')
    tried.current = forKey
    setState({ busy: true, error: '' })
    try {
      const res = await briefIdeas(brief, { signal: job.start() })
      update((d) => ({ ...d, briefIdeas: { ...res, key: forKey, at: now() } }))
      setState({ busy: false, error: '' })
    } catch (err) {
      if (err?.name === 'AbortError') return
      setState({ busy: false, error: errorMessage(err) })
    }
  }

  useEffect(() => {
    if (!claudeOk || !norm(b.client) || !norm(b.offer)) return undefined
    if (stored?.key === key || tried.current === key) return undefined
    const t = setTimeout(refresh, 1500)
    return () => clearTimeout(t)
    // refresh reads the latest brief through a ref; only the inputs that shape ideas matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, claudeOk])

  const ideas = useMemo(() => offlineIdeas(b, stored), [b, stored])
  return { ideas, claudeOk, tailored: !!stored && stored.key === key, ...state, refresh }
}

// A row of tap-to-add chips under a text field. Tapping again removes it.
export function Suggest({ field, value, onChange, items, label = 'Tap to add' }) {
  if (!items?.length) return null
  return (
    <div className="suggest">
      <span className="suggest-label">{label}</span>
      <div className="chips">
        {items.map((it) => {
          const on = hasItem(field, value, it)
          return (
            <button key={it} type="button" className={`chip suggest-chip ${on ? 'on' : ''}`} onClick={() => onChange(toggleItem(field, value, it))}>
              <Icon name={on ? 'check' : 'plus'} size={11} />{it}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function IdeasStatus({ coach }) {
  const { go } = useStore()
  if (!coach.claudeOk) {
    return <span className="field-hint">Instant ideas. <button type="button" className="link-btn" onClick={() => go('settings')}>Connect Claude</button> for ideas tailored to this client.</span>
  }
  if (coach.busy) return <span className="status-line"><Icon name="sparkle" size={12} /> Claude is tailoring ideas…</span>
  if (coach.error) return <span className="field-hint">Couldn’t get Claude’s ideas: {coach.error} <button type="button" className="link-btn" onClick={coach.refresh}>Try again</button></span>
  return (
    <span className="field-hint">
      {coach.tailored ? 'Ideas tailored by Claude. ' : 'Add the brand and what it sells for tailored ideas. '}
      <button type="button" className="link-btn" onClick={coach.refresh}>Refresh ideas</button>
    </span>
  )
}

// ---- Goal ----------------------------------------------------------------------------------------

export function GoalPicker({ brief, setBrief, ideas }) {
  const [own, setOwn] = useState('')
  const goals = brief.goals || []
  const custom = goals.filter((g) => !GOAL_PRESETS.includes(g))
  const claudeGoals = ideas.goals.filter((g) => !goals.includes(g))
  const add = (text) => {
    const g = text.trim()
    if (!g || goals.some((x) => norm(x) === norm(g))) return
    setBrief({ goals: [...goals, g] })
    setOwn('')
  }
  const placeholder = goals.some((g) => /sales|launch/i.test(g))
    ? 'e.g. ₹5 lakh of orders from Instagram by March'
    : goals.some((g) => /DM|enquir|book|lead/i.test(g))
      ? 'e.g. 30 enquiries a month from Delhi NCR'
      : 'e.g. 2,000 new followers in Mumbai by Diwali'
  return (
    <div className="goal-picker">
      {GOAL_GROUPS.map((g) => (
        <div key={g.group} className="interest-group">
          <span className="field-hint">{g.group}</span>
          <Chips options={g.items} value={goals} onChange={(next) => setBrief({ goals: next })} />
        </div>
      ))}
      {(custom.length > 0 || claudeGoals.length > 0) && (
        <div className="interest-group">
          <span className="field-hint">{claudeGoals.length ? `Ideas for ${brief.client || 'this client'}` : 'Your own'}</span>
          <div className="chips">
            {custom.map((g) => (
              <button key={g} type="button" className="chip on" onClick={() => setBrief({ goals: goals.filter((x) => x !== g) })}><Icon name="check" size={11} />{g}</button>
            ))}
            {claudeGoals.map((g) => (
              <button key={g} type="button" className="chip suggest-chip" onClick={() => add(g)}><Icon name="plus" size={11} />{g}</button>
            ))}
          </div>
        </div>
      )}
      <div className="add-chip">
        <input value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(own) }} placeholder="Add your own goal" aria-label="Add your own goal" />
        <IconBtn icon="plus" label="Add goal" onClick={() => add(own)} />
      </div>
      <label className="field">
        <span className="label">Make it measurable <span className="mute">(optional)</span></span>
        <input value={brief.goal} onChange={(e) => setBrief({ goal: e.target.value })} placeholder={placeholder} />
      </label>
    </div>
  )
}

// ---- What they sell ------------------------------------------------------------------------------

export function OfferPicker({ brief, setBrief }) {
  const cat = categoryFor(brief)
  const [open, setOpen] = useState(false)
  // Picking a category only steers the suggestions; it never rewrites what the user typed.
  const pick = (c) => {
    setBrief({ category: brief.category === c.id ? '' : c.id })
    setOpen(false)
  }
  if (cat && !open) {
    return (
      <div className="suggest">
        <span className="field-hint">
          Ideas below are for <strong>{cat.label.toLowerCase()}</strong>. <button type="button" className="link-btn" onClick={() => setOpen(true)}>Not right?</button>
          {!brief.offer && <> · <button type="button" className="link-btn" onClick={() => setBrief({ offer: cat.offer })}>Start from “{cat.offer}”</button></>}
        </span>
      </div>
    )
  }
  return (
    <div className="suggest">
      <span className="suggest-label">Pick the closest match</span>
      <div className="chips">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" className={`chip ${cat?.id === c.id ? 'on' : ''}`} onClick={() => pick(c)}>{c.label}</button>
        ))}
      </div>
    </div>
  )
}

// ---- Voice by "this or that" --------------------------------------------------------------------

export function VoicePairs({ brief, setBrief }) {
  const choose = (pair, word) => {
    const other = pair.find((w) => w !== word)
    let v = brief.voice
    if (hasItem('voice', v, other)) v = toggleItem('voice', v, other)
    setBrief({ voice: toggleItem('voice', v, word) })
  }
  return (
    <div className="voice-pairs">
      {VOICE_PAIRS.map((pair) => (
        <div key={pair.join()} className="segmented sm" role="group" aria-label={pair.join(' or ')}>
          {pair.map((w) => (
            <button key={w} type="button" className={hasItem('voice', brief.voice, w) ? 'on' : ''} onClick={() => choose(pair, w)}>{w}</button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ---- Audience --------------------------------------------------------------------------------------

export function AgeBands({ audience, onChange }) {
  const { ageMin = 18, ageMax = 65 } = audience
  const picked = AGE_BANDS.filter(([lo, hi]) => lo >= ageMin && hi <= ageMax)
  const toggle = (band) => {
    const has = picked.includes(band)
    const next = has ? picked.filter((b) => b !== band) : [...picked, band]
    if (!next.length) return
    onChange({ ageMin: Math.min(...next.map((b) => b[0])), ageMax: Math.max(...next.map((b) => b[1])) })
  }
  return (
    <div className="chips">
      {AGE_BANDS.map((band) => (
        <button key={band[0]} type="button" className={`chip ${picked.includes(band) ? 'on' : ''}`} onClick={() => toggle(band)}>
          {band[1] >= 65 ? `${band[0]}+` : `${band[0]}–${band[1]}`}
        </button>
      ))}
    </div>
  )
}

// ---- Competitors and reading ------------------------------------------------------------------------

export function CompetitorFinder({ brief, setBrief, coach }) {
  const { doc, update } = useStore()
  const { busy, run, cancel } = useRunner()
  const [handle, setHandle] = useState('')
  const [link, setLink] = useState('')
  const handles = handlesOf(brief.competitors)
  const found = doc.competitorIdeas
  const reading = brief.reading || []
  const city = brief.audience?.locations?.[0]

  const addHandle = (h) => {
    const clean = `@${String(h).trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '')}`
    if (clean.length < 3 || handles.some((x) => norm(x) === norm(clean))) return
    setBrief({ competitors: [...handles, clean].join(', ') })
    setHandle('')
  }
  const removeHandle = (h) => setBrief({ competitors: handles.filter((x) => x !== h).join(', ') })
  const hasArticle = (url) => reading.some((r) => r.url === url)
  const addArticle = (a) => {
    if (hasArticle(a.url)) return
    setBrief({ reading: [...reading, { id: uid('rd'), title: a.title, url: a.url, note: a.why || '' }] })
  }
  const addLink = () => {
    const u = link.trim()
    if (!/^https?:\/\//i.test(u)) return
    addArticle({ title: u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60), url: u, why: '' })
    setLink('')
  }
  const find = () => run('find', async (signal) => {
    const res = await findCompetitors(brief, { signal })
    update((d) => ({ ...d, competitorIdeas: { ...res, at: now() } }))
  })

  return (
    <div className="competitors">
      {handles.length > 0 && (
        <div className="chips">
          {handles.map((h) => (
            <span key={h} className="chip on">{h}<button type="button" className="chip-x" aria-label={`Remove ${h}`} onClick={() => removeHandle(h)}><Icon name="x" size={10} /></button></span>
          ))}
        </div>
      )}
      <div className="row">
        <input value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addHandle(handle) }} placeholder="@handle or Instagram link" aria-label="Add a competitor handle" />
        <IconBtn icon="plus" label="Add handle" onClick={() => addHandle(handle)} />
        {coach.claudeOk && (busy
          ? <Btn size="sm" kind="ghost" onClick={cancel}>Stop</Btn>
          : <Btn size="sm" icon="sparkle" onClick={find} disabled={!brief.client && !brief.offer} tip="Claude searches Instagram and the web for real competitors and useful articles">{found ? 'Find more' : 'Find for me'}</Btn>)}
      </div>
      {busy && <p className="status-line"><Icon name="search" size={12} /> Searching Instagram and the web…</p>}

      {found?.handles?.length > 0 && (
        <div className="found-list">
          <span className="suggest-label">Accounts worth watching. Check each one before you rely on it.</span>
          {found.handles.map((h) => {
            const added = handles.some((x) => norm(x) === norm(h.handle))
            return (
              <div key={h.handle} className="found-row">
                <div className="found-body">
                  <a href={`https://www.instagram.com/${h.handle.slice(1)}/`} target="_blank" rel="noopener noreferrer">{h.handle}</a>
                  {h.name && <span className="mute"> · {h.name}</span>}
                  {h.why && <span className="field-hint">{h.why}</span>}
                </div>
                <Btn size="sm" kind="ghost" icon={added ? 'check' : 'plus'} disabled={added} onClick={() => addHandle(h.handle)}>{added ? 'Added' : 'Add'}</Btn>
              </div>
            )
          })}
        </div>
      )}
      {found?.articles?.length > 0 && (
        <div className="found-list">
          <span className="suggest-label">Worth reading</span>
          {found.articles.map((a) => (
            <div key={a.url} className="found-row">
              <div className="found-body">
                <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
                {a.why && <span className="field-hint">{a.why}</span>}
              </div>
              <Btn size="sm" kind="ghost" icon={hasArticle(a.url) ? 'check' : 'bookmark'} disabled={hasArticle(a.url)} onClick={() => addArticle(a)}>{hasArticle(a.url) ? 'Saved' : 'Save'}</Btn>
            </div>
          ))}
        </div>
      )}

      {coach.ideas.tags.length > 0 && (
        <div className="suggest">
          <span className="suggest-label">{coach.claudeOk ? 'Or browse what’s popular' : 'Browse these on Instagram to spot competitors'}</span>
          <div className="chips">
            {[...coach.ideas.tags, ...(city ? [`${coach.ideas.tags[0]}${city.toLowerCase()}`] : [])].map((t) => (
              <a key={t} className="chip" href={`https://www.instagram.com/explore/tags/${encodeURIComponent(t)}/`} target="_blank" rel="noopener noreferrer"><Icon name="external" size={11} />#{t}</a>
            ))}
          </div>
        </div>
      )}

      <div className="reading">
        <span className="suggest-label">Articles and inspiration{reading.length ? ` · ${reading.length} saved` : ''}</span>
        {reading.map((r) => (
          <div key={r.id} className="found-row">
            <div className="found-body">
              <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
              {r.note && <span className="field-hint">{r.note}</span>}
            </div>
            <IconBtn icon="x" label="Remove" onClick={() => setBrief({ reading: reading.filter((x) => x.id !== r.id) })} />
          </div>
        ))}
        <div className="row">
          <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addLink() }} placeholder="Paste an article or website link" aria-label="Add an article link" />
          <IconBtn icon="plus" label="Save link" onClick={addLink} />
        </div>
      </div>
    </div>
  )
}

// ---- Interview ---------------------------------------------------------------------------------------

const QUESTIONS = [
  { id: 'client', q: 'What’s the brand called?', help: 'The name people know it by. You can change it any time.' },
  { id: 'offer', q: 'What does it sell?', help: 'One line is plenty. “We sell ___ to ___” works well.' },
  { id: 'goals', q: 'What should Instagram do for the business in the next three months?', help: 'Pick as many as you like. Most brands want a mix of engagement and sales.' },
  { id: 'audience', q: 'Picture one person who buys. Who are they?', help: 'Tap what fits. Rough is fine; Promote uses this for ad targeting later.' },
  { id: 'voice', q: 'If the brand walked into a room, how would it talk?', help: 'Pick one side of each pair, or tap the words that fit.' },
  { id: 'cta', q: 'After someone sees a post, what’s the one thing they should do?', help: 'This ends every caption, so make it easy to do.' },
  { id: 'dos', q: 'What should every post show?', help: 'Think about what your happiest customers mention.' },
  { id: 'donts', q: 'What would make you cringe on your own feed?', help: 'Things the brand never wants to look or sound like.' },
  { id: 'competitors', q: 'Whose Instagram do you keep an eye on?', help: 'Rivals, or brands you admire from any industry.' },
]

export function Interview({ onClose, coach }) {
  const { doc } = useStore()
  const setBrief = useSetBrief()
  const b = doc.brief
  const [i, setI] = useState(() => {
    // Start at the first unanswered question.
    const first = QUESTIONS.findIndex((x) => !answered(b, x.id))
    return first < 0 ? 0 : first
  })
  const [done, setDone] = useState(false)
  const q = QUESTIONS[i]
  const { score } = briefCompleteness(b)
  const setAudience = (patch) => setBrief((br) => ({ audience: { ...br.audience, ...patch } }))
  const next = () => (i < QUESTIONS.length - 1 ? setI(i + 1) : setDone(true))
  const field = (name, rows) => (rows
    ? <textarea rows={rows} value={b[name]} onChange={(e) => setBrief({ [name]: e.target.value })} aria-label={q.q} />
    : <input autoFocus value={b[name]} onChange={(e) => setBrief({ [name]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') next() }} aria-label={q.q} />)

  if (done) {
    return (
      <Modal title="Brief interview" onClose={onClose} width={620} footer={<Btn kind="primary" icon="check" onClick={onClose}>Done</Btn>}>
        <div className="interview-done">
          <span className="big-num">{score}%</span>
          <p>{score === 100 ? 'The brief is complete. Every plan and caption now uses it.' : 'Good start. Anything you skipped can be filled in on the page, with suggestions under each field.'}</p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Brief interview"
      onClose={onClose}
      width={620}
      footer={(
        <>
          <span className="field-hint">{i + 1} of {QUESTIONS.length}</span>
          <span className="grow" />
          {i > 0 && <Btn kind="ghost" icon="left" onClick={() => setI(i - 1)}>Back</Btn>}
          <Btn kind="ghost" onClick={next}>Skip</Btn>
          <Btn kind="primary" icon={i === QUESTIONS.length - 1 ? 'check' : 'right'} onClick={next}>{i === QUESTIONS.length - 1 ? 'Finish' : 'Next'}</Btn>
        </>
      )}
    >
      <Meter value={Math.round(((i + 1) / QUESTIONS.length) * 100)} tone="ok" />
      <div className="interview">
        <h3 className="interview-q">{q.q}</h3>
        <p className="field-hint">{q.help}</p>
        {q.id === 'client' && field('client')}
        {q.id === 'offer' && (<>{field('offer')}<OfferPicker brief={b} setBrief={setBrief} /></>)}
        {q.id === 'goals' && <GoalPicker brief={b} setBrief={setBrief} ideas={coach.ideas} />}
        {q.id === 'audience' && (
          <>
            <span className="suggest-label">Mostly</span>
            <Chips options={GENDERS} value={b.audience.genders} onChange={(genders) => setAudience({ genders })} />
            <span className="suggest-label">Aged</span>
            <AgeBands audience={b.audience} onChange={setAudience} />
            <span className="suggest-label">Living in</span>
            <Chips options={INDIA_CITIES} value={b.audience.locations} onChange={(locations) => setAudience({ locations })} />
            <span className="suggest-label">In a sentence (optional)</span>
            {field('target', 2)}
            <Suggest field="target" value={b.target} onChange={(target) => setBrief({ target })} items={coach.ideas.target} label="Or start from" />
          </>
        )}
        {q.id === 'voice' && (
          <>
            <VoicePairs brief={b} setBrief={setBrief} />
            {field('voice')}
            <Suggest field="voice" value={b.voice} onChange={(voice) => setBrief({ voice })} items={coach.ideas.voice} />
          </>
        )}
        {q.id === 'cta' && (<>{field('cta')}<Suggest field="cta" value={b.cta} onChange={(cta) => setBrief({ cta })} items={coach.ideas.cta} /></>)}
        {q.id === 'dos' && (<>{field('dos', 3)}<Suggest field="dos" value={b.dos} onChange={(dos) => setBrief({ dos })} items={coach.ideas.dos} /></>)}
        {q.id === 'donts' && (<>{field('donts', 3)}<Suggest field="donts" value={b.donts} onChange={(donts) => setBrief({ donts })} items={coach.ideas.donts} /></>)}
        {q.id === 'competitors' && <CompetitorFinder brief={b} setBrief={setBrief} coach={coach} />}
        <IdeasStatus coach={coach} />
      </div>
    </Modal>
  )
}

function answered(b, id) {
  if (id === 'goals') return b.goals?.length || b.goal
  if (id === 'audience') return b.target || b.audience?.locations?.length
  return String(b[id] || '').trim()
}
