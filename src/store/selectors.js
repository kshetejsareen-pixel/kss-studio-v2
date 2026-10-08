// Derived numbers for the step rail and the "Next" bar. Pure functions of the document.
import { briefCompleteness } from '../lib/brief.js'
import { isPhoto, postStage } from '../data/model.js'

const STAGE_ORDER = ['idea', 'planned', 'designed', 'captioned', 'approved', 'scheduled', 'published', 'measured']
const atLeast = (post, stage) => STAGE_ORDER.indexOf(postStage(post)) >= STAGE_ORDER.indexOf(stage)

// { [stepId]: { text, tone: 'ok' | 'warn' | 'mute', done } }
export function stepStatuses(doc) {
  const photos = doc.images.filter(isPhoto)
  const toAnalyse = photos.filter((i) => !i.analysedAt).length
  const posts = doc.posts
  const filled = posts.filter((p) => p.slides.length || p.design?.exportImageId)
  const designed = posts.filter((p) => p.design?.exportImageId).length
  const captioned = filled.filter((p) => p.caption?.text?.trim()).length
  const approved = filled.filter((p) => p.approved).length
  const scheduled = filled.filter((p) => p.approved && p.schedule?.at).length
  const published = posts.filter((p) => atLeast(p, 'published')).length
  const measured = posts.filter((p) => p.metrics?.latest).length
  const { score } = briefCompleteness(doc.brief)
  const n = filled.length
  const frac = (k) => (n ? `${k} / ${n}` : '—')
  return {
    brief: { text: `${score}%`, tone: score < 50 ? 'warn' : 'ok', done: score >= 75 },
    library: {
      text: photos.length ? (toAnalyse ? `${photos.length} · ${toAnalyse} to analyse` : `${photos.length}`) : '—',
      tone: toAnalyse ? 'warn' : photos.length ? 'ok' : 'mute',
      done: photos.length > 0 && !toAnalyse,
    },
    plan: { text: posts.length ? `${n} / ${posts.length} filled` : '—', tone: n ? 'ok' : 'mute', done: n > 0 && n === posts.length },
    create: { text: designed ? `${designed} designed` : '—', tone: designed ? 'ok' : 'mute', done: false },
    write: { text: frac(captioned), tone: n && captioned < n ? 'warn' : n ? 'ok' : 'mute', done: n > 0 && captioned === n },
    review: { text: frac(approved), tone: n && approved < n ? 'warn' : n ? 'ok' : 'mute', done: n > 0 && approved === n },
    schedule: { text: scheduled || published ? `${scheduled} queued · ${published} live` : '—', tone: scheduled || published ? 'ok' : 'mute', done: false },
    measure: { text: published ? `${measured} / ${published}` : '—', tone: published && measured < published ? 'warn' : published ? 'ok' : 'mute', done: false },
  }
}

// The most useful next thing to do, for the sticky footer.
export function nextAction(doc, step) {
  const s = stepStatuses(doc)
  const photos = doc.images.filter(isPhoto).length
  if (step === 'brief' && !photos) return { step: 'library', label: 'Import your photos' }
  if (step === 'library' && photos) return { step: 'plan', label: 'Arrange the grid' }
  if (step === 'plan' && doc.posts.some((p) => p.slides.length)) return { step: 'create', label: 'Design graphics, or skip to captions' }
  if (step === 'create') return { step: 'write', label: 'Write captions' }
  if (step === 'write' && s.write.done) return { step: 'review', label: 'Check and approve' }
  if (step === 'review' && doc.posts.some((p) => p.approved)) return { step: 'schedule', label: 'Put approved posts on the calendar' }
  if (step === 'schedule' && doc.posts.some((p) => p.publish?.igMediaId)) return { step: 'measure', label: 'See how they did' }
  if (step === 'measure') return { step: 'brief', label: 'Feed learnings into the next plan' }
  return null
}
