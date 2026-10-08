// Plan: arrange the grid. Photos on the left, the phone grid in the middle, the chosen post on
// the right. Photos already in the plan stay visible but faded, labelled with where they're used.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Btn, IconBtn, Field, Empty, Segmented, Frame, Modal, useRunner, confirmAction } from '../components/ui.jsx'
import { CropView, CarouselModal, Tile, DRAG_IMAGES, DRAG_POST, DRAG_SLIDE, dragIds, hasDrag } from '../components/media.jsx'
import { useStore } from '../store/StoreProvider.jsx'
import {
  byId, usageMap, imageShelf, isPhoto, isPublished, postLabelAt, slide, newPost,
  FORMATS, POST_ASPECTS, GRID_RATIOS, MAX_SLIDES, formatLabel,
} from '../data/model.js'
import { planGrid, refinePlan, planScope, blankPosts } from '../lib/studio.js'
import { gridHealth } from '../lib/health.js'
import { briefCompleteness } from '../lib/brief.js'
import { suggestTest, TEST_METRICS, metricInfo, AB_CAVEAT } from '../lib/insights.js'

const POOL_TABS = [['unused', 'Unused'], ['planned', 'In plan'], ['all', 'All'], ['shortlist', 'Shortlist']]
const FORMAT_ICON = { single: 'single', carousel: 'carousel', reel: 'reel', story: 'story' }
const DEFAULT_SLOTS = 9

const editable = (p) => p && !p.locked && !isPublished(p)

// Format follows the number of slides unless it's a reel or story.
const fixFormat = (p) => ({
  ...p,
  format: p.slides.length > 1 && p.format === 'single' ? 'carousel' : p.slides.length <= 1 && p.format === 'carousel' ? 'single' : p.format,
})

export default function Plan() {
  const { doc, update, getDoc, settings, toast, go, route } = useStore()
  const { busy, run, cancel } = useRunner()
  const [selectedId, setSelectedId] = useState(route.params?.postId || null)
  const [slideIdx, setSlideIdx] = useState(0)
  const [armed, setArmed] = useState([])
  const [poolTab, setPoolTab] = useState('unused')
  const [poolTheme, setPoolTheme] = useState('')
  const [groupByTheme, setGroupByTheme] = useState(false)
  const [showFeed, setShowFeed] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const [highlight, setHighlight] = useState([])
  const [refineText, setRefineText] = useState('')
  const [preview, setPreview] = useState(null)

  useEffect(() => { if (route.params?.postId) setSelectedId(route.params.postId) }, [route.params?.postId])

  const posts = doc.posts
  const images = byId(doc.images)
  const kits = useMemo(() => byId(doc.themes), [doc.themes])
  const usage = useMemo(() => usageMap(posts), [posts])
  const shortlist = useMemo(() => new Set(doc.shortlist), [doc.shortlist])
  const issues = useMemo(() => gridHealth(doc), [doc])
  const brief = useMemo(() => briefCompleteness(doc.brief), [doc.brief])
  const selIndex = posts.findIndex((p) => p.id === selectedId)
  const selected = selIndex >= 0 ? posts[selIndex] : null
  const openCount = posts.filter((p) => !isPublished(p)).length

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (armed.length) setArmed([])
      else setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [armed.length])

  // ---- Post edits ----
  const setPosts = (fn) => update((d) => ({ ...d, posts: fn(d.posts) }))
  const patchPost = (id, patch) => setPosts((ps) => ps.map((p) => (p.id === id ? fixFormat({ ...p, ...(typeof patch === 'function' ? patch(p) : patch) }) : p)))
  const labelOf = (id) => postLabelAt(posts, posts.findIndex((p) => p.id === id))

  const snapshot = () => getDoc().posts
  const undoable = (message, before) => toast(message, {
    kind: 'success',
    duration: 8000,
    action: { label: 'Undo', fn: () => { setPosts(() => before); toast('Change undone', { kind: 'info' }) } },
  })

  const guard = (post) => {
    if (editable(post)) return true
    toast(isPublished(post) ? `${labelOf(post.id)} is already posted.` : `Unlock ${labelOf(post.id)} first.`, { kind: 'error' })
    return false
  }

  const alsoUsed = (ids, postId) => {
    const others = new Map()
    for (const id of ids) {
      for (const u of usage.get(id) || []) if (u.postId !== postId && !u.posted) others.set(u.postId, u.label)
    }
    return [...others.entries()]
  }

  const placeImages = (post, ids, mode) => {
    if (!post || !ids.length || !guard(post)) return
    const clean = ids.filter((id) => images.has(id))
    patchPost(post.id, (p) => {
      const keep = mode === 'add' ? p.slides : []
      const have = new Set(keep.map((s) => s.imageId))
      const added = clean.filter((id) => !have.has(id)).map((id) => slide(id))
      return { slides: [...keep, ...added], design: mode === 'replace' ? null : p.design }
    })
    const total = (mode === 'add' ? post.slides.length : 0) + clean.length
    if (total > MAX_SLIDES) toast(`${labelOf(post.id)} now has ${total} slides — Instagram allows ${MAX_SLIDES}.`, { kind: 'error' })
    const others = alsoUsed(clean, post.id)
    if (others.length) {
      const set = new Set(clean)
      toast(`Also used in ${others.map(([, l]) => l).join(', ')}`, {
        kind: 'info',
        duration: 8000,
        action: {
          label: 'Move here',
          fn: () => setPosts((ps) => ps.map((p) => (others.some(([pid]) => pid === p.id) && editable(p)
            ? fixFormat({ ...p, slides: p.slides.filter((s) => !set.has(s.imageId)) })
            : p))),
        },
      })
    }
    setSelectedId(post.id)
    setArmed([])
  }

  const swapPosts = (from, to, message = 'Posts swapped — undo available') => {
    const a = posts[from]
    const b = posts[to]
    if (!a || !b || from === to) return
    if (!editable(a) || !editable(b)) {
      toast('Locked or posted posts stay where they are.', { kind: 'error' })
      return
    }
    const before = snapshot()
    setPosts((ps) => {
      const next = [...ps]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    toast(message, { kind: 'success', duration: 8000, action: { label: 'Undo', fn: () => { setPosts(() => before); toast('Swap undone', { kind: 'info' }) } } })
  }

  const setSlotCount = (target) => {
    const n = Math.max(1, Math.min(60, target))
    if (n > openCount) {
      setPosts((ps) => [...blankPosts(n - openCount), ...ps])
      return
    }
    if (n === openCount) return
    // Remove from the top: empty posts first, then the newest filled ones.
    let drop = openCount - n
    const empty = posts.filter((p) => editable(p) && !p.slides.length).map((p) => p.id)
    const removeIds = new Set(empty.slice(0, drop))
    drop -= removeIds.size
    if (drop > 0) {
      const filled = posts.filter((p) => editable(p) && p.slides.length).slice(0, drop)
      if (filled.length < drop) {
        toast('Locked posts stay — unlock some to remove more slots.', { kind: 'error' })
        return
      }
      if (!confirmAction(`Reducing to ${n} slots will remove ${filled.length} filled posts. Continue?`)) return
      filled.forEach((p) => removeIds.add(p.id))
    }
    const before = snapshot()
    setPosts((ps) => ps.filter((p) => !removeIds.has(p.id)))
    if (removeIds.has(selectedId)) setSelectedId(null)
    if (drop > 0) undoable(`${removeIds.size} slots removed`, before)
  }

  const addPost = () => {
    const p = newPost()
    setPosts((ps) => [p, ...ps])
    setSelectedId(p.id)
  }

  const removePost = (post) => {
    if (isPublished(post)) {
      toast('Posted posts stay in the plan so their results can be tracked.', { kind: 'error' })
      return
    }
    const before = snapshot()
    setPosts((ps) => ps.filter((p) => p.id !== post.id))
    setSelectedId(null)
    undoable(`${labelOf(post.id)} removed`, before)
  }

  const lockPlan = () => {
    const ids = new Set(posts.filter((p) => !isPublished(p) && p.slides.length).map((p) => p.id))
    if (!ids.size) {
      toast('Fill some posts first.', { kind: 'error' })
      return
    }
    setPosts((ps) => ps.map((p) => (ids.has(p.id) ? { ...p, locked: true } : p)))
    toast('Plan locked — generate captions', { kind: 'success', action: { label: 'Write captions', fn: () => go('write') } })
  }
  const allLocked = posts.some((p) => p.slides.length && !isPublished(p)) && posts.filter((p) => p.slides.length && !isPublished(p)).every((p) => p.locked)
  const unlockAll = () => setPosts((ps) => ps.map((p) => (isPublished(p) ? p : { ...p, locked: false })))

  // ---- Claude ----
  const runPlan = async ({ notes, mix }) => {
    update((d) => ({ ...d, planNotes: notes, planMix: mix }))
    if (!posts.some((p) => !isPublished(p))) setPosts((ps) => [...blankPosts(DEFAULT_SLOTS), ...ps])
    const before = snapshot()
    const res = await run('plan', (signal) => planGrid(getDoc(), { notes, mix, handle: settings.handle, signal }))
    if (!res) return
    setPosts(() => res.posts)
    setPlanOpen(false)
    const extra = res.autoExcluded ? ` ${res.autoExcluded} white-background photos left out.` : ''
    undoable(`Plan generated — ${res.filled} / ${res.total} posts filled. Ask me to refine anything.${extra}`, before)
  }
  const runRefine = async (e) => {
    e?.preventDefault()
    const text = refineText.trim()
    if (!text) return
    const before = snapshot()
    const res = await run('refine', (signal) => refinePlan(getDoc(), text, { signal }))
    if (!res) return
    setPosts(() => res.posts)
    setRefineText('')
    undoable(`Done — ${res.filled} / ${res.total} posts updated.`, before)
  }

  const makeTest = async (post, metric) => {
    const test = await run('test', (signal) => suggestTest(getDoc(), post, metric, { signal }))
    if (!test) return
    const b = newPost({
      format: post.format,
      aspect: post.aspect,
      slides: post.slides.map((s) => ({ ...s })),
      themeId: post.themeId,
      pillar: post.pillar,
      notes: `B variant of ${labelOf(post.id)} — ${test.change}`,
    })
    update((d) => {
      const i = d.posts.findIndex((p) => p.id === post.id)
      const next = [...d.posts]
      next.splice(Math.max(0, i), 0, b)
      return { ...d, posts: next, tests: [{ ...test, bPostId: b.id }, ...d.tests] }
    })
    setSelectedId(b.id)
    toast(`Test set up: ${test.name}. Change the B post, then schedule both.`, { kind: 'success', duration: 9000 })
  }

  // ---- Pool ----
  const pool = useMemo(() => {
    const photos = doc.images.filter(isPhoto)
    let list
    if (poolTab === 'unused') list = photos.filter((i) => imageShelf(i, usage) === 'unused')
    else if (poolTab === 'planned') list = photos.filter((i) => usage.get(i.id)?.length)
    else if (poolTab === 'shortlist') list = doc.shortlist.map((id) => images.get(id)).filter(Boolean)
    else list = photos.filter((i) => i.cull !== 'reject')
    if (poolTheme) list = list.filter((i) => (poolTheme === 'none' ? !i.themeId : i.themeId === poolTheme))
    if (poolTab !== 'shortlist') list = [...list].sort((a, b) => (shortlist.has(b.id) - shortlist.has(a.id)) || ((b.cull === 'keep') - (a.cull === 'keep')))
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.images, doc.shortlist, usage, poolTab, poolTheme, shortlist])

  const poolCounts = useMemo(() => {
    const photos = doc.images.filter(isPhoto)
    return {
      unused: photos.filter((i) => imageShelf(i, usage) === 'unused').length,
      planned: photos.filter((i) => usage.get(i.id)?.length).length,
      all: photos.filter((i) => i.cull !== 'reject').length,
      shortlist: doc.shortlist.length,
    }
  }, [doc.images, doc.shortlist, usage])

  const armedSet = new Set(armed)
  const toggleArm = (id, e) => {
    if (e?.shiftKey || e?.metaKey || e?.ctrlKey || armed.length) {
      setArmed(armedSet.has(id) ? armed.filter((x) => x !== id) : [...armed, id])
    } else {
      setArmed([id])
    }
  }
  const dragIdsFor = (id) => (armedSet.has(id) ? armed : [id])

  const addToShortlist = (ids) => update((d) => ({ ...d, shortlist: [...new Set([...d.shortlist, ...ids])] }))
  const removeFromShortlist = (id) => update((d) => ({ ...d, shortlist: d.shortlist.filter((x) => x !== id) }))

  // ---- Render ----
  const photosCount = doc.images.filter(isPhoto).length
  if (!photosCount) {
    return (
      <Empty icon="image" title="Import images first" action={<Btn kind="primary" icon="library" onClick={() => go('library')}>Go to Library</Btn>}>
        The plan is built from your photos. Bring in the shoot, then come back here.
      </Empty>
    )
  }

  const feedExtras = showFeed
    ? doc.feed.items.filter((it) => !posts.some((p) => p.publish?.igMediaId === it.id) && it.productType !== 'STORY').slice(0, 30)
    : []

  return (
    <div className={`plan ${selected ? 'with-post' : ''}`}>
      {/* Zone A: photos */}
      <section className="plan-pool" aria-label="Photos">
        <div className="pool-tabs" role="tablist">
          {POOL_TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={poolTab === id} className={poolTab === id ? 'on' : ''} onClick={() => setPoolTab(id)}>
              {label} <span className="count">{poolCounts[id]}</span>
            </button>
          ))}
        </div>
        <div className="pool-filters">
          <select value={poolTheme} onChange={(e) => setPoolTheme(e.target.value)} aria-label="Theme">
            <option value="">All themes</option>
            <option value="none">No theme</option>
            {doc.themes.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          {doc.themes.length > 0 && (
            <IconBtn icon="layers" label={groupByTheme ? 'Ungroup' : 'Group by theme'} active={groupByTheme} onClick={() => setGroupByTheme(!groupByTheme)} />
          )}
        </div>
        {armed.length > 0 && (
          <div className="armed-bar">
            <span>{armed.length} picked — drag onto a post, or click a post to place</span>
            <IconBtn icon="x" label="Clear (Esc)" onClick={() => setArmed([])} size={13} />
          </div>
        )}
        <div className="pool-scroll">
          {pool.length ? (
            groupByTheme ? (
              [...doc.themes, { id: null, name: 'No theme', color: 'var(--mute2)' }].map((k) => {
                const items = pool.filter((i) => (i.themeId || null) === k.id)
                if (!items.length) return null
                return (
                  <div key={k.id || 'none'} className="pool-group">
                    <div className="pool-group-head"><span className="swatch" style={{ background: k.color }} /> {k.name} <span className="count">{items.length}</span></div>
                    {poolGrid(items)}
                  </div>
                )
              })
            ) : poolGrid(pool)
          ) : (
            <p className="field-hint pad">
              {poolTab === 'unused' ? 'Every photo is in the plan or set aside.' : poolTab === 'shortlist' ? 'Star photos in the Library, or drop them on the shortlist strip under the grid.' : 'Nothing here.'}
            </p>
          )}
        </div>
      </section>

      {/* Zone B: the grid */}
      <section className="plan-grid-wrap" aria-label="Grid">
        {brief.score < 50 && (
          <div className="banner warn inline">
            <Icon name="brief" size={14} />
            <span>The brief is {brief.score}% done. Claude plans better with the audience, pillars and theme kits filled in.</span>
            <Btn size="sm" kind="ghost" onClick={() => go('brief')}>Open brief</Btn>
          </div>
        )}
        <div className="toolbar">
          <Btn kind="primary" icon="sparkle" onClick={() => setPlanOpen(true)} busy={busy === 'plan'}>Plan with Claude</Btn>
          <Btn kind="ghost" icon="warning" onClick={() => setHealthOpen(!healthOpen)} className={issues.length ? 'has-issues' : ''}>
            Grid health{issues.length ? ` (${issues.length})` : ''}
          </Btn>
          {allLocked
            ? <Btn kind="ghost" icon="unlock" onClick={unlockAll}>Unlock plan</Btn>
            : <Btn kind="ghost" icon="lock" onClick={lockPlan} tip="Lock every filled post so Claude won't move it. Then write captions.">Lock plan</Btn>}
          <span className="grow" />
          <div className="stepper" aria-label="Slots">
            <IconBtn icon="minus" label="Fewer slots" onClick={() => setSlotCount(openCount - 1)} disabled={openCount <= 1} size={13} />
            <span>{openCount} slots</span>
            <IconBtn icon="plus" label="More slots" onClick={() => setSlotCount(openCount + 1)} size={13} />
          </div>
          <Segmented size="sm" value={doc.gridRatio} onChange={(v) => update((d) => ({ ...d, gridRatio: v }))} options={GRID_RATIOS.map((r) => [r, r, r === '3:4' ? 'How the profile grid crops posts now' : undefined])} />
          {doc.feed.items.length > 0 && (
            <IconBtn icon={showFeed ? 'eyeOff' : 'eye'} label={showFeed ? 'Hide live posts' : 'Show live posts under the plan'} active={showFeed} onClick={() => setShowFeed(!showFeed)} />
          )}
        </div>

        <form className="refine-bar" onSubmit={runRefine}>
          <Icon name="sparkle" size={14} />
          <input value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder="Ask Claude to change the plan: “put the portraits in row 1”, “fewer carousels”" disabled={busy === 'refine' || !posts.length} aria-label="Refine the plan" />
          {busy === 'refine' ? <Btn size="sm" kind="ghost" onClick={cancel}>Stop</Btn> : <Btn size="sm" kind="ghost" type="submit" disabled={!refineText.trim()}>Refine</Btn>}
        </form>

        {healthOpen && (
          <div className="health-panel">
            {issues.length ? issues.map((x) => (
              <div key={x.id} className={`health-item ${x.severity}`} onMouseEnter={() => setHighlight(x.indices)} onMouseLeave={() => setHighlight([])}>
                <Icon name={x.severity === 'high' ? 'warning' : 'info'} size={13} />
                <span className="grow">{x.text}</span>
                {x.swap && <Btn size="sm" kind="ghost" icon="swap" onClick={() => swapPosts(x.swap.from, x.swap.to)}>Swap {postLabelAt(posts, x.swap.from)} ↔ {postLabelAt(posts, x.swap.to)}</Btn>}
              </div>
            )) : <p className="field-hint"><Icon name="check" size={13} /> No issues found — grid looks good</p>}
          </div>
        )}

        {posts.length ? (
          <div className="phone">
            <div className="phone-head">
              <span className="phone-handle">{settings.handle || '@studio'}</span>
              <span className="mute small-text">{posts.filter((p) => p.slides.length).length} planned · {posts.filter(isPublished).length} live</span>
            </div>
            <div className="grid3" style={{ '--cell-aspect': doc.gridRatio.replace(':', ' / ') }}>
              {posts.map((p, i) => (
                <Cell
                  key={p.id}
                  post={p}
                  index={i}
                  label={postLabelAt(posts, i)}
                  image={images.get(p.design?.exportImageId || p.slides[0]?.imageId)}
                  crop={p.design?.exportImageId ? null : p.slides[0]?.crop}
                  kit={kits.get(p.themeId)}
                  ratio={doc.gridRatio}
                  selected={p.id === selectedId}
                  highlighted={highlight.includes(i)}
                  armed={armed.length > 0}
                  onSelect={() => {
                    if (armed.length && editable(p)) placeImages(p, armed, p.slides.length ? 'add' : 'replace')
                    else { setSelectedId(p.id === selectedId ? null : p.id); setSlideIdx(0) }
                  }}
                  onDropImages={(ids, mode) => placeImages(p, ids, mode)}
                  onDropPost={(from) => swapPosts(from, i)}
                  onPreview={() => setPreview(p.id)}
                />
              ))}
              {feedExtras.map((it) => (
                <div key={it.id} className="cell live" title={`Live · ${it.caption.slice(0, 80)}`}>
                  {it.thumb ? <span className="cell-img" style={{ backgroundImage: `url("${it.thumb}")` }} /> : <span className="cell-empty"><Icon name="image" size={16} /></span>}
                  <span className="cell-label">Live</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty icon="grid" title="No posts yet" action={(
            <div className="row center">
              <Btn kind="primary" icon="sparkle" onClick={() => setPlanOpen(true)}>Plan with Claude</Btn>
              <Btn kind="ghost" icon="plus" onClick={() => setSlotCount(DEFAULT_SLOTS)}>Start {DEFAULT_SLOTS} empty slots</Btn>
            </div>
          )}>
            Let Claude draft the grid from your photos, brief and theme kits, or lay it out by hand.
          </Empty>
        )}

        {/* Zone D: shortlist strip */}
        <ShortlistStrip ids={doc.shortlist} images={images} usage={usage} onAdd={addToShortlist} onRemove={removeFromShortlist} dragIdsFor={dragIdsFor} />
      </section>

      {/* Zone C: the post */}
      <section className="plan-side" aria-label={selected ? 'Post' : 'Plan summary'}>
        {selected ? (
          <PostPanel
            key={selected.id}
            post={selected}
            label={postLabelAt(posts, selIndex)}
            slideIdx={Math.min(slideIdx, Math.max(0, selected.slides.length - 1))}
            setSlideIdx={setSlideIdx}
            images={images}
            onPatch={(patch) => { if (guard(selected)) patchPost(selected.id, patch) }}
            onPlace={(ids) => placeImages(selected, ids, 'add')}
            onClose={() => setSelectedId(null)}
            onRemove={() => removePost(selected)}
            onPreview={() => setPreview(selected.id)}
            onToggleLock={() => { if (!isPublished(selected)) patchPost(selected.id, { locked: !selected.locked }) }}
            onTest={(metric) => makeTest(selected, metric)}
            testBusy={busy === 'test'}
            tests={doc.tests.filter((t) => t.aPostId === selected.id || t.bPostId === selected.id)}
            labelOf={labelOf}
            onOpen={(step) => go(step, { postId: selected.id })}
          />
        ) : (
          <PlanSummary doc={doc} usage={usage} issues={issues} onAddPost={addPost} />
        )}
      </section>

      {planOpen && <PlanModal doc={doc} busy={busy === 'plan'} onCancel={cancel} onClose={() => { if (busy === 'plan') cancel(); setPlanOpen(false) }} onRun={runPlan} />}
      {preview && (() => {
        const i = posts.findIndex((p) => p.id === preview)
        return i >= 0 ? <CarouselModal post={posts[i]} label={postLabelAt(posts, i)} onClose={() => setPreview(null)} /> : null
      })()}
    </div>
  )

  // A plain function, not a component: a component defined here would remount every tile
  // on each render and cancel drags in progress.
  function poolGrid(items) {
    return (
      <div className="pool-grid">
        {items.map((img) => (
          <Tile
            key={img.id}
            image={img}
            uses={usage.get(img.id)}
            kit={kits.get(img.themeId)}
            selected={armedSet.has(img.id)}
            shortlisted={shortlist.has(img.id)}
            dim={!!usage.get(img.id)?.length || img.setAside}
            onClick={(e) => toggleArm(img.id, e)}
            dragIdsFor={dragIdsFor}
          />
        ))}
      </div>
    )
  }
}

// One tile in the phone grid. Drop on the left two-thirds to replace, on the right third to add a slide.
function Cell({ post, index, label, image, crop, kit, ratio, selected, highlighted, armed, onSelect, onDropImages, onDropPost, onPreview }) {
  const [zone, setZone] = useState(null)
  const live = isPublished(post)
  const n = post.slides.length
  const zoneOf = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    // The right third adds a slide (builds a carousel); the rest replaces the cover.
    return e.clientX - r.left > r.width * 0.65 ? 'add' : 'replace'
  }
  const over = (e) => {
    if (hasDrag(e, DRAG_IMAGES)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setZone(n ? zoneOf(e) : 'replace')
    } else if (hasDrag(e, DRAG_POST)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setZone('swap')
    }
  }
  const drop = (e) => {
    e.preventDefault()
    const z = zone
    setZone(null)
    if (hasDrag(e, DRAG_IMAGES)) onDropImages(dragIds(e), n ? (z === 'add' ? 'add' : 'replace') : 'replace')
    else if (hasDrag(e, DRAG_POST)) onDropPost(Number(e.dataTransfer.getData(DRAG_POST)))
  }
  return (
    <div
      className={`cell ${selected ? 'selected' : ''} ${highlighted ? 'highlight' : ''} ${live ? 'posted' : ''} ${post.locked ? 'locked' : ''} ${zone ? `drop-${zone}` : ''} ${armed && !live && !post.locked ? 'armed' : ''}`}
      onClick={onSelect}
      onDoubleClick={onPreview}
      onDragOver={over}
      onDragLeave={() => setZone(null)}
      onDrop={drop}
      draggable={!live && !post.locked}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_POST, String(index)); e.dataTransfer.effectAllowed = 'move' }}
      role="button"
      tabIndex={0}
      aria-label={`${label}${n ? `, ${formatLabel(post.format)}` : ', empty'}`}
      aria-pressed={selected}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect() }}
    >
      {image ? <Frame image={image} crop={crop} aspect={ratio} className="cell-frame" /> : <span className="cell-empty"><Icon name="plus" size={16} /><span>Drop photos</span></span>}
      {kit && <span className="cell-kit" style={{ background: kit.color }} title={kit.name} />}
      <span className="cell-label">{label}</span>
      <span className="cell-icons">
        {post.locked && !live && <Icon name="lock" size={11} />}
        {live && <Icon name="check" size={11} />}
        {post.format !== 'single' && <Icon name={FORMAT_ICON[post.format] || 'single'} size={12} />}
        {n > 1 && <span>{n}</span>}
      </span>
      {zone === 'add' && <span className="cell-zone add"><Icon name="plus" size={14} /> slide</span>}
      {zone === 'replace' && <span className="cell-zone replace">{n ? 'Replace' : 'Place'}</span>}
      {zone === 'swap' && <span className="cell-zone replace"><Icon name="swap" size={14} /> Swap</span>}
    </div>
  )
}

function ShortlistStrip({ ids, images, usage, onAdd, onRemove, dragIdsFor }) {
  const { thumbs } = useStore()
  const [over, setOver] = useState(false)
  return (
    <div
      className={`shortlist-strip ${over ? 'over' : ''}`}
      onDragOver={(e) => { if (hasDrag(e, DRAG_IMAGES)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onAdd(dragIds(e)) }}
    >
      <span className="label"><Icon name="star" size={11} /> Shortlist</span>
      {ids.length ? ids.map((id) => {
        const img = images.get(id)
        if (!img) return null
        const used = usage.get(id)?.length
        return (
          <div
            key={id}
            className={`strip-thumb ${used ? 'used' : ''}`}
            style={{ backgroundImage: thumbs[id] ? `url("${thumbs[id]}")` : undefined }}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG_IMAGES, dragIdsFor(id).join(','))}
            title={img.name}
          >
            <button type="button" className="tile-x" aria-label="Remove from shortlist" onClick={() => onRemove(id)}><Icon name="x" size={10} /></button>
          </div>
        )
      }) : <span className="field-hint">Drop the photos you can't leave out here.</span>}
    </div>
  )
}

function PostPanel({ post, label, slideIdx, setSlideIdx, images, onPatch, onPlace, onClose, onRemove, onPreview, onToggleLock, onTest, testBusy, tests, labelOf, onOpen }) {
  const { doc } = useStore()
  const [metric, setMetric] = useState('saveRate')
  const [trayOver, setTrayOver] = useState(false)
  const live = isPublished(post)
  const locked = post.locked || live
  const cur = post.slides[slideIdx]
  const pillars = (doc.brief.pillars || []).filter((p) => p.name)

  const moveSlide = (from, to) => {
    if (from === to) return
    onPatch((p) => {
      const s = [...p.slides]
      const [x] = s.splice(from, 1)
      s.splice(to, 0, x)
      return { slides: s }
    })
    setSlideIdx(to)
  }
  const removeSlide = (i) => {
    onPatch((p) => ({ slides: p.slides.filter((_, j) => j !== i) }))
    setSlideIdx(Math.max(0, i - 1))
  }
  const setCrop = (crop) => onPatch((p) => ({ slides: p.slides.map((s, j) => (j === slideIdx ? { ...s, crop } : s)) }))
  const trayDrop = (e) => {
    e.preventDefault()
    setTrayOver(false)
    if (hasDrag(e, DRAG_IMAGES)) onPlace(dragIds(e))
  }

  return (
    <div className="post-panel">
      <header className="panel-head">
        <h3>{label} <span className="mute">· {formatLabel(post.format)}</span></h3>
        <div className="row">
          <IconBtn icon="play" label="Preview as on Instagram" onClick={onPreview} disabled={!post.slides.length && !post.design?.exportImageId} />
          {!live && <IconBtn icon={post.locked ? 'lock' : 'unlock'} label={post.locked ? 'Unlock' : 'Lock (Claude won’t change it)'} active={post.locked} onClick={onToggleLock} />}
          <IconBtn icon="x" label="Close (Esc)" onClick={onClose} />
        </div>
      </header>

      {live && <div className="banner inline"><Icon name="check" size={14} /><span>Posted. Changes here won’t reach Instagram.</span></div>}

      {cur ? (
        locked
          ? <Frame image={images.get(cur.imageId)} crop={cur.crop} aspect={post.aspect} full className="panel-frame" />
          : <CropView image={images.get(cur.imageId)} crop={cur.crop} aspect={post.aspect} onChange={setCrop} />
      ) : (
        <div
          className={`panel-drop ${trayOver ? 'over' : ''}`}
          onDragOver={(e) => { if (hasDrag(e, DRAG_IMAGES)) { e.preventDefault(); setTrayOver(true) } }}
          onDragLeave={() => setTrayOver(false)}
          onDrop={trayDrop}
        >
          <Icon name="image" size={22} />
          <span>Drop photos here, or pick them on the left and click this post.</span>
        </div>
      )}

      <div className="field">
        <span className="field-head">
          <span className="label">Slides</span>
          <span className={post.slides.length > MAX_SLIDES ? 'warn-text' : 'mute small-text'}>{post.slides.length} / {MAX_SLIDES}</span>
        </span>
        <div
          className={`slide-tray ${trayOver ? 'over' : ''}`}
          onDragOver={(e) => { if (!locked && (hasDrag(e, DRAG_IMAGES) || hasDrag(e, DRAG_SLIDE))) { e.preventDefault(); if (hasDrag(e, DRAG_IMAGES)) setTrayOver(true) } }}
          onDragLeave={() => setTrayOver(false)}
          onDrop={(e) => { if (hasDrag(e, DRAG_IMAGES)) trayDrop(e) }}
        >
          {post.slides.map((s, i) => (
            <SlideThumb
              key={`${s.imageId}${i}`}
              s={s}
              i={i}
              image={images.get(s.imageId)}
              on={i === slideIdx}
              locked={locked}
              onClick={() => setSlideIdx(i)}
              onRemove={() => removeSlide(i)}
              onMove={moveSlide}
            />
          ))}
          {!locked && <span className="tray-add"><Icon name="plus" size={14} /></span>}
        </div>
        {post.slides.length > 1 && <span className="field-hint">Drag to reorder. Slide 1 is the cover in the grid.</span>}
        {post.design?.exportImageId && <span className="field-hint">The designed graphic replaces slide 1 when published.</span>}
      </div>

      <fieldset disabled={locked} className="plain">
        <Field label="Format" group>
          <Segmented size="sm" value={post.format} onChange={(v) => onPatch({ format: v })} options={FORMATS.map((f) => [f.id, f.label])} />
        </Field>
        {post.format !== 'reel' && post.format !== 'story' && (
          <Field label="Post shape" group>
            <Segmented size="sm" value={post.aspect} onChange={(v) => onPatch({ aspect: v })} options={POST_ASPECTS.map((a) => [a, a])} />
          </Field>
        )}
        <div className="form-grid">
          <Field label="Theme">
            <select value={post.themeId || ''} onChange={(e) => onPatch({ themeId: e.target.value || null })}>
              <option value="">No theme</option>
              {doc.themes.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </Field>
          <Field label="Pillar">
            <select value={post.pillar || ''} onChange={(e) => onPatch({ pillar: e.target.value })}>
              <option value="">None</option>
              {pillars.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Notes" hint="Why this post is here. Claude reads it when writing the caption.">
          <textarea rows={2} value={post.notes} onChange={(e) => onPatch({ notes: e.target.value })} />
        </Field>
      </fieldset>

      <div className="row wrap">
        <Btn size="sm" kind="ghost" icon="create" onClick={() => onOpen('create')} disabled={!post.slides.length}>Design graphic</Btn>
        <Btn size="sm" kind="ghost" icon="write" onClick={() => onOpen('write')} disabled={!post.slides.length}>Caption</Btn>
      </div>

      <div className="card soft">
        <div className="card-head"><span className="label"><Icon name="flask" size={12} /> A/B test</span></div>
        {tests.length ? tests.map((t) => (
          <div key={t.id} className="test-line">
            <strong>{t.name}</strong>
            <span className="small-text">{labelOf(t.aPostId)} (A) vs {labelOf(t.bPostId)} (B) · {metricInfo(t.metric).label}</span>
            {t.change && <span className="small-text mute">B changes: {t.change}</span>}
          </div>
        )) : (
          <>
            <p className="small-text mute">Claude suggests one change to test, and adds a B copy of this post next to it.</p>
            <div className="row">
              <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric to improve">
                {TEST_METRICS.map((m) => <option key={m} value={m}>{metricInfo(m).label}</option>)}
              </select>
              <Btn size="sm" kind="ghost" icon="flask" onClick={() => onTest(metric)} busy={testBusy} disabled={!post.slides.length || live}>Set up test</Btn>
            </div>
            <p className="field-hint">{AB_CAVEAT}</p>
          </>
        )}
      </div>

      {!live && <Btn size="sm" kind="danger" icon="trash" onClick={onRemove}>Remove post</Btn>}
    </div>
  )
}

function SlideThumb({ s, i, image, on, locked, onClick, onRemove, onMove }) {
  const { thumbs } = useStore()
  const [over, setOver] = useState(false)
  return (
    <div
      className={`slide-thumb ${on ? 'on' : ''} ${over ? 'over' : ''}`}
      style={{ backgroundImage: thumbs[s.imageId] ? `url("${thumbs[s.imageId]}")` : undefined }}
      onClick={onClick}
      draggable={!locked}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_SLIDE, String(i)); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={(e) => { if (hasDrag(e, DRAG_SLIDE)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (hasDrag(e, DRAG_SLIDE)) { e.preventDefault(); e.stopPropagation(); setOver(false); onMove(Number(e.dataTransfer.getData(DRAG_SLIDE)), i) } }}
      title={image?.name}
      role="button"
      tabIndex={0}
      aria-label={`Slide ${i + 1}`}
    >
      <span className="slide-num">{i + 1}</span>
      {!locked && <button type="button" className="tile-x" aria-label="Remove slide" onClick={(e) => { e.stopPropagation(); onRemove() }}><Icon name="x" size={10} /></button>}
    </div>
  )
}

// When no post is selected: what the plan is made of, against the brief.
function PlanSummary({ doc, usage, issues, onAddPost }) {
  const filled = doc.posts.filter((p) => p.slides.length)
  const photos = doc.images.filter(isPhoto)
  const unused = photos.filter((i) => imageShelf(i, usage) === 'unused').length
  const byFormat = FORMATS.map((f) => [f.label, filled.filter((p) => p.format === f.id).length]).filter(([, n]) => n)
  const byTheme = doc.themes.map((k) => ({
    k,
    posts: filled.filter((p) => p.themeId === k.id).length,
    left: photos.filter((i) => i.themeId === k.id && imageShelf(i, usage) === 'unused').length,
  }))
  const pillars = (doc.brief.pillars || []).filter((p) => p.name)
  const max = Math.max(1, filled.length)
  return (
    <div className="plan-summary">
      <header className="panel-head"><h3>This plan</h3><Btn size="sm" kind="ghost" icon="plus" onClick={onAddPost}>Add post</Btn></header>
      <div className="stat-row">
        <div className="stat"><span className="big-num">{filled.length}</span><span className="label">posts filled</span></div>
        <div className="stat"><span className="big-num">{unused}</span><span className="label">photos unused</span></div>
        <div className="stat"><span className={`big-num ${issues.length ? 'warn-text' : ''}`}>{issues.length}</span><span className="label">grid issues</span></div>
      </div>
      {byFormat.length > 0 && (
        <div className="drawer-sec">
          <span className="label">Formats</span>
          {byFormat.map(([l, n]) => <Bar key={l} label={l} value={n} max={max} />)}
          <span className="field-hint">Brief asks for {doc.brief.cadence.mix.single}% single · {doc.brief.cadence.mix.carousel}% carousel · {doc.brief.cadence.mix.reel}% reel.</span>
        </div>
      )}
      {byTheme.length > 0 && (
        <div className="drawer-sec">
          <span className="label">Themes</span>
          {byTheme.map(({ k, posts, left }) => <Bar key={k.id} label={k.name} value={posts} max={max} color={k.color} note={`${left} photos left`} />)}
        </div>
      )}
      {pillars.length > 0 && (
        <div className="drawer-sec">
          <span className="label">Pillars</span>
          {pillars.map((p) => {
            const n = filled.filter((x) => x.pillar === p.name).length
            return <Bar key={p.id} label={p.name} value={n} max={max} note={`${Math.round((n / max) * 100)}% · aim ${p.share || 0}%`} />
          })}
        </div>
      )}
      <div className="drawer-sec">
        <span className="label">How to use this screen</span>
        <ul className="hint-list">
          <li>Drag photos from the left onto a post. Drop on its right third to add a slide and make a carousel.</li>
          <li>Pick several with ⌘/Ctrl or Shift, then drag them together for a carousel.</li>
          <li>Drag one post onto another to swap them. Double-click to preview.</li>
          <li>Faded photos are already in the plan; the label says where.</li>
        </ul>
      </div>
    </div>
  )
}

function Bar({ label, value, max, color, note }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span className="bar-track"><span style={{ width: `${(value / max) * 100}%`, background: color }} /></span>
      <span className="bar-value">{value}{note ? <span className="mute"> · {note}</span> : null}</span>
    </div>
  )
}

function PlanModal({ doc, busy, onCancel, onClose, onRun }) {
  const [notes, setNotes] = useState(doc.planNotes || '')
  const [mix, setMix] = useState(doc.planMix || 'mixed')
  const scope = planScope(doc, { notes })
  const open = doc.posts.filter((p) => !isPublished(p) && !p.locked).length || DEFAULT_SLOTS
  const refs = doc.references.filter((r) => r.analysis || r.imageId).length
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <Modal
      title="Plan with Claude"
      onClose={onClose}
      footer={busy
        ? <><span className="status-line"><span className="spinner" /> Planning {open} posts…</span><Btn kind="ghost" onClick={onCancel}>Stop</Btn></>
        : <><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="sparkle" onClick={() => onRun({ notes, mix })} disabled={!scope.images.length}>Plan {open} posts</Btn></>}
    >
      <ul className="scope-list">
        <li><Icon name="image" size={13} /> {scope.images.length} photos to choose from{doc.shortlist.length ? `, shortlist first` : ''}</li>
        <li><Icon name="grid" size={13} /> {open} open slots — locked and posted posts stay put</li>
        <li><Icon name="palette" size={13} /> {doc.themes.length ? `${doc.themes.length} theme kits` : 'No theme kits yet — add them in the Brief'}</li>
        <li><Icon name="bookmark" size={13} /> {refs ? `${refs} reference grids to follow` : 'No reference grids — add screenshots in the Brief'}</li>
        <li><Icon name="target" size={13} /> {doc.learnings.filter((l) => l.active).length} learnings from past results</li>
      </ul>
      <Field label="Mix" group>
        <Segmented value={mix} onChange={setMix} options={[['mixed', 'Mixed'], ['carousels', 'Carousel heavy'], ['stills', 'Singles only']]} />
      </Field>
      <Field label="Direction" hint="Anything Claude must follow: “open with the brass detail”, “no white backgrounds”, “alternate dark and light”.">
        <textarea ref={ref} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  )
}
