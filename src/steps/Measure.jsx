// Measure: sync Instagram insights, compare every post with the account's usual numbers,
// see what is working by format, theme, pillar and time, turn it into learnings that feed
// the next plan, and read A/B test results.
import { useMemo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Btn, IconBtn, Empty, Segmented, Frame, useRunner, confirmAction } from '../components/ui.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import { useConnections } from '../components/shell.jsx'
import { byId, formatLabel, postLabel } from '../data/model.js'
import {
  METRIC_INFO, RATE_KEYS, AB_CAVEAT, syncInsights, applyInsights, measureRows, baselines, verdict,
  VERDICT_LABELS, formatMetric, metricInfo, BREAKDOWNS, breakdown, generateLearnings, compareTest,
} from '../lib/insights.js'
import { metaConfigured } from '../lib/meta.js'
import { formatIst, relativeTime, WEEKDAYS } from '../lib/time.js'

const RANK_METRICS = ['saveRate', 'shareRate', 'engagementRate', 'reach']
const PAGE = 30

export default function Measure() {
  const { doc, update, getDoc, settings, toast, go } = useStore()
  const claudeOk = useConnections().claude.tone === 'ok'
  const { busy, run, cancel } = useRunner()
  const [metric, setMetric] = useState('saveRate')
  const [by, setBy] = useState('format')
  const [progress, setProgress] = useState(null)
  const [open, setOpen] = useState(null)
  const [limit, setLimit] = useState(PAGE)

  const rows = useMemo(() => measureRows(doc), [doc])
  const base = useMemo(() => baselines(rows), [rows])
  const groups = useMemo(() => breakdown(rows, by, metric), [rows, by, metric])
  const rowsByPost = useMemo(() => new Map(rows.filter((r) => r.postId).map((r) => [r.postId, r])), [rows])
  const themes = byId(doc.themes)
  const connected = metaConfigured(settings)
  const info = metricInfo(metric)

  const sync = async (force = false) => {
    const res = await run('sync', (signal) => syncInsights(getDoc(), settings, { signal, force, onProgress: (done, total) => setProgress({ done, total }) }))
    setProgress(null)
    if (!res) return
    update((d) => applyInsights(d, res))
    const n = Object.keys(res.results).length
    toast(`${n} post${n === 1 ? '' : 's'} updated${res.errors.length ? ` · ${res.errors.length} failed` : ''}`, { kind: res.errors.length ? 'info' : 'success' })
  }

  const learn = async () => {
    const res = await run('learn', (signal) => generateLearnings(getDoc(), settings, { signal }))
    if (!res) return
    const prev = { learnings: getDoc().learnings, insightSummary: getDoc().insightSummary }
    update((d) => ({ ...d, learnings: res.learnings, insightSummary: { summary: res.summary, next: res.next, at: new Date().toISOString() } }))
    toast(`${res.learnings.length} learnings from ${res.basis} posts — active ones feed the next plan`, {
      kind: 'success',
      action: { label: 'Undo', fn: () => update((d) => ({ ...d, ...prev })) },
    })
  }

  const setLearning = (id, patch) => update((d) => ({ ...d, learnings: d.learnings.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const removeLearning = (id) => update((d) => ({ ...d, learnings: d.learnings.filter((l) => l.id !== id) }))

  const moreLikeThis = (r) => {
    const theme = themes.get(r.themeId)?.name
    const note = `More like ${r.label || 'the post'} (${formatLabel(r.format).toLowerCase()}${theme ? `, ${theme}` : ''}) — its ${info.label.toLowerCase()} was ${formatMetric(r.rates?.[metric], info.kind)} against a usual ${formatMetric(base[metric], info.kind)}.`
    update((d) => ({ ...d, planNotes: [d.planNotes, note].filter(Boolean).join('\n') }))
    toast('Added to the plan direction notes', { kind: 'success', action: { label: 'Open Plan', fn: () => go('plan') } })
  }

  const removeTest = (id) => {
    if (!confirmAction('Delete this test? The posts stay in the plan.')) return
    update((d) => ({ ...d, tests: d.tests.filter((t) => t.id !== id) }))
  }

  const groupLabel = (key) => {
    if (by === 'theme') return themes.get(key)?.name || 'No theme'
    if (by === 'format') return formatLabel(key)
    if (by === 'weekday') return WEEKDAYS[key]
    if (by === 'hour') return `${key % 12 || 12} ${key < 12 ? 'am' : 'pm'}`
    return String(key)
  }
  const maxGroup = Math.max(0, ...groups.map((g) => g.median || 0))

  return (
    <div className="measure">
      {!connected && (
        <div className="banner warn">
          <Icon name="key" size={14} />
          <span>Connect Instagram in Settings to pull insights for your posts.</span>
          <Btn size="sm" kind="ghost" onClick={() => go('settings')}>Settings</Btn>
        </div>
      )}

      <div className="toolbar">
        {busy === 'sync'
          ? <Btn kind="ghost" onClick={cancel}>Cancel</Btn>
          : <Btn kind="primary" icon="refresh" disabled={!connected || !!busy} onClick={() => sync(false)} tip="Fetch the latest numbers from Instagram">Sync insights</Btn>}
        {progress && <span className="status-line">Fetching {progress.done} of {progress.total}…</span>}
        {!progress && doc.feed.fetchedAt && <span className="mute">Synced {relativeTime(doc.feed.fetchedAt)}</span>}
        <span className="spacer" />
        <span className="label">Judge by</span>
        <Segmented value={metric} onChange={setMetric} size="sm" options={RANK_METRICS.map((k) => [k, metricInfo(k).label, metricInfo(k).desc])} />
      </div>

      {!rows.length ? (
        <Empty icon="chart" title="No published posts yet" action={connected ? <Btn kind="primary" icon="refresh" busy={busy === 'sync'} onClick={() => sync(false)}>Import my feed</Btn> : null}>
          Sync to import your recent Instagram posts and their numbers. Posts published from here are tracked automatically at 48 hours and 7 days.
        </Empty>
      ) : (
        <>
          <div className="kpis">
            {RATE_KEYS.map((k) => {
              const m = metricInfo(k)
              return (
                <div key={k} className={`kpi ${k === metric ? 'on' : ''}`} title={m.desc}>
                  <span className="label">Usual {m.label.toLowerCase()}</span>
                  <span className="big-num">{formatMetric(base[k], m.kind)}</span>
                </div>
              )
            })}
            <div className="kpi">
              <span className="label">Based on</span>
              <span className="big-num">{base.count}</span>
              <span className="mute">recent posts</span>
            </div>
          </div>

          <div className="measure-body">
            <section className="measure-main">
              <div className="measure-table" role="table">
                <div className="mt-row mt-head" role="row">
                  <span>Post</span><span>Posted</span><span>Reach</span><span>Saves</span><span>Shares</span><span>Engagement</span><span>{info.label}</span>
                </div>
                {rows.slice(0, limit).map((r) => {
                  const v = verdict(r.rates?.[metric], base[metric])
                  const isOpen = open === r.id
                  return (
                    <div key={r.id} className={`mt-item ${isOpen ? 'open' : ''}`}>
                      <button type="button" className="mt-row" role="row" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                        <span className="mt-post">
                          <RowThumb row={r} />
                          <span className="mt-text">
                            <strong>{r.label || formatLabel(r.format)}</strong>
                            <span className="mute">{r.caption.split('\n')[0].slice(0, 60) || 'No caption'}</span>
                          </span>
                        </span>
                        <span className="mute">{r.timestamp ? formatIst(r.timestamp, { day: 'numeric', month: 'short' }) : '–'}</span>
                        <span>{formatMetric(r.rates?.reach, 'count')}</span>
                        <span>{formatMetric(r.rates?.saveRate, 'rate')}</span>
                        <span>{formatMetric(r.rates?.shareRate, 'rate')}</span>
                        <span>{formatMetric(r.rates?.engagementRate, 'rate')}</span>
                        <span>{v ? <span className={`verdict ${v}`}>{VERDICT_LABELS[v]}</span> : <span className="mute">–</span>}</span>
                      </button>
                      {isOpen && <RowDetail row={r} theme={themes.get(r.themeId)} base={base} onMore={() => moreLikeThis(r)} onBoost={() => go('promote', { postId: r.postId })} />}
                    </div>
                  )
                })}
              </div>
              {rows.length > limit && <Btn kind="ghost" size="sm" onClick={() => setLimit(limit + PAGE)}>Show more ({rows.length - limit})</Btn>}
            </section>

            <aside className="measure-side">
              <section className="card">
                <header className="card-head"><h2>What's working</h2></header>
                <Segmented value={by} onChange={setBy} size="sm" options={Object.entries(BREAKDOWNS).map(([k, b]) => [k, b.label])} />
                {groups.length ? (
                  <div className="bars">
                    {groups.map((g) => (
                      <div key={g.key} className="bar-row" title={`${g.count} post${g.count > 1 ? 's' : ''}`}>
                        <span className="bar-label">{groupLabel(g.key)}</span>
                        <span className="bar-track"><span style={{ width: `${maxGroup ? (g.median / maxGroup) * 100 : 0}%` }} /></span>
                        <span className="bar-value">{formatMetric(g.median, info.kind)} <span className="mute">· {g.count}</span></span>
                      </div>
                    ))}
                  </div>
                ) : <p className="field-hint">Not enough measured posts to compare yet.</p>}
                <p className="field-hint">Median {info.label.toLowerCase()} per group, with the number of posts. Groups of one post are a hint at most.</p>
              </section>

              <section className="card">
                <header className="card-head">
                  <h2>Learnings</h2>
                  <Btn size="sm" kind="ghost" icon="sparkle" busy={busy === 'learn'} disabled={!claudeOk || !!busy || !base.count} onClick={learn} tip="Claude reads your numbers and writes what to do more and less of">
                    {doc.learnings.length ? 'Refresh' : 'Find patterns'}
                  </Btn>
                </header>
                {doc.insightSummary.summary && <p>{doc.insightSummary.summary}</p>}
                {doc.insightSummary.next.length > 0 && (
                  <>
                    <span className="label">Next plan</span>
                    <ul className="hint-list">{doc.insightSummary.next.map((n) => <li key={n}>{n}</li>)}</ul>
                  </>
                )}
                {doc.learnings.length ? (
                  <ul className="learning-list">
                    {doc.learnings.map((l) => (
                      <li key={l.id} className={l.active ? '' : 'off'}>
                        <label className="switch">
                          <input type="checkbox" checked={l.active} onChange={(e) => setLearning(l.id, { active: e.target.checked })} />
                          <span>{l.text}</span>
                        </label>
                        <span className={`confidence ${l.confidence}`}>{l.confidence}</span>
                        {l.evidence && <p className="field-hint">{l.evidence}</p>}
                        <IconBtn icon="trash" label="Delete learning" size={13} onClick={() => removeLearning(l.id)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">Switched-on learnings are added to every Plan, Create and Write prompt, so the next batch builds on what worked.</p>
                )}
              </section>

              <section className="card">
                <header className="card-head"><h2>A/B tests</h2></header>
                {doc.tests.length ? doc.tests.map((t) => {
                  const res = compareTest(t, rowsByPost)
                  const tm = metricInfo(t.metric)
                  return (
                    <div key={t.id} className={`test-card ${res.status}`}>
                      <div className="test-line">
                        <strong>{t.name}</strong>
                        <IconBtn icon="trash" label="Delete test" size={13} onClick={() => removeTest(t.id)} />
                      </div>
                      {t.hypothesis && <p className="field-hint">{t.hypothesis}</p>}
                      <div className="test-ab">
                        <span>A · {postLabel(doc.posts, t.aPostId) || 'removed'} <strong>{formatMetric(res.a, tm.kind)}</strong></span>
                        <span>B · {postLabel(doc.posts, t.bPostId) || 'not set'} <strong>{formatMetric(res.b, tm.kind)}</strong></span>
                      </div>
                      <p className="test-result">
                        {res.status === 'waiting' && 'Waiting for both posts to be published and synced.'}
                        {res.status === 'tie' && `No clear difference in ${tm.label.toLowerCase()}.`}
                        {(res.status === 'a' || res.status === 'b') && `${res.status.toUpperCase()} wins on ${tm.label.toLowerCase()}${res.diff != null ? ` by ${Math.abs(Math.round(res.diff * 100))}%` : ''}.`}
                      </p>
                    </div>
                  )
                }) : <p className="field-hint">Start a test from a post in Plan: Claude suggests one change, and a B copy of the post is added to the grid.</p>}
                <p className="field-hint">{AB_CAVEAT}</p>
              </section>

              <details className="card glossary">
                <summary><span className="label">What the numbers mean</span></summary>
                <dl>
                  {METRIC_INFO.map((m) => (
                    <div key={m.key}><dt>{m.label}</dt><dd>{m.desc}</dd></div>
                  ))}
                </dl>
                <p className="field-hint">Above usual means at least 20% better than the median of your last 20 posts; below usual, 20% worse.</p>
              </details>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

function RowThumb({ row }) {
  const { doc } = useStore()
  const image = row.imageId ? doc.images.find((i) => i.id === row.imageId) : null
  if (image) return <span className="mini-thumb"><Frame image={image} aspect="1:1" /></span>
  return (
    <span className="mini-thumb">
      {row.thumbUrl
        ? <img src={row.thumbUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
        : <Icon name="image" size={14} />}
    </span>
  )
}

function RowDetail({ row, theme, base, onMore, onBoost }) {
  const snaps = [['48 hours', row.snapshots?.h48], ['7 days', row.snapshots?.d7]].filter(([, s]) => s)
  const extra = ['profileVisitRate', 'followsPer1k', 'avgWatch', 'skipRate'].filter((k) => row.rates?.[k] != null)
  return (
    <div className="mt-detail">
      <div className="mt-detail-grid">
        <div>
          <span className="label">Details</span>
          <p>{formatLabel(row.format)}{theme ? ` · ${theme.name}` : ''}{row.pillar ? ` · ${row.pillar}` : ''}</p>
          {row.timestamp && <p className="mute">{formatIst(row.timestamp)} IST</p>}
          {row.likes != null && <p className="mute">{row.likes} likes · {row.comments ?? 0} comments</p>}
        </div>
        {extra.length > 0 && (
          <div>
            <span className="label">More</span>
            {extra.map((k) => {
              const m = metricInfo(k)
              const v = verdict(row.rates[k], base[k])
              return <p key={k} title={m.desc}>{m.label}: {formatMetric(row.rates[k], m.kind)} {v && <span className={`verdict ${v}`}>{VERDICT_LABELS[v]}</span>}</p>
            })}
          </div>
        )}
        {snaps.length > 0 && (
          <div>
            <span className="label">Snapshots</span>
            {snaps.map(([name, s]) => <p key={name}>{name}: {formatMetric(s.reach, 'count')} reach · {s.saved ?? 0} saves · {s.shares ?? 0} shares</p>)}
          </div>
        )}
      </div>
      {row.caption && <p className="review-caption">{row.caption}</p>}
      <div className="row wrap">
        {row.postId && <Btn size="sm" kind="ghost" icon="grid" onClick={onMore} tip="Add a note to the plan direction so Claude plans more like this">More like this</Btn>}
        {row.postId && <Btn size="sm" kind="ghost" icon="megaphone" onClick={onBoost}>Boost</Btn>}
        {row.permalink && <a className="btn ghost sm" href={row.permalink} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Instagram</a>}
      </div>
    </div>
  )
}
