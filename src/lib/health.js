// Grid health: fast checks that run on every change, without Claude. Each issue names the
// posts involved (grid indices) and, where a swap would fix it, the swap to make.
import { byId, postLabelAt, MAX_SLIDES } from '../data/model.js'
import { colorDistance, hamming, DUPLICATE_DISTANCE } from './image.js'

const cover = (post) => post.slides[0]?.imageId || null

function similar(a, b) {
  if (!a || !b) return false
  if (a.dupOf === b.id || b.dupOf === a.id) return true
  if (a.phash && b.phash && hamming(a.phash, b.phash) <= DUPLICATE_DISTANCE * 2) return true
  const pa = a.profile || {}
  const pb = b.profile || {}
  const sameSubject = pa.subject && pa.subject === pb.subject && pa.shot && pa.shot === pb.shot
  const close = a.palette?.[0] && b.palette?.[0] && colorDistance(a.palette[0], b.palette[0]) < 40
  return !!(sameSubject && close)
}

export function gridHealth(doc) {
  const posts = doc.posts
  const images = byId(doc.images)
  const issues = []
  const add = (severity, text, indices, swap = null) => issues.push({
    id: `${severity}:${text}`, severity, text, posts: indices.map((i) => postLabelAt(posts, i)), indices, swap,
  })
  const imgAt = (i) => images.get(cover(posts[i]))

  posts.forEach((p, i) => {
    if (!p.slides.length) add('medium', `${postLabelAt(posts, i)} is empty`, [i])
    if (p.slides.length > MAX_SLIDES) add('high', `${postLabelAt(posts, i)} has ${p.slides.length} slides — Instagram allows ${MAX_SLIDES}`, [i])
    if (p.slides.length > 1) {
      const kinds = new Set(p.slides.map((s) => images.get(s.imageId)?.orientation).filter(Boolean))
      if (kinds.size > 1) add('medium', `${postLabelAt(posts, i)} mixes orientations — every slide is cropped to the first slide's shape`, [i])
    }
  })

  // Neighbours: right-hand tile and the tile below.
  for (let i = 0; i < posts.length; i++) {
    for (const j of [i % 3 < 2 ? i + 1 : -1, i + 3]) {
      if (j < 0 || j >= posts.length) continue
      const a = imgAt(i)
      const b = imgAt(j)
      const sameTheme = posts[i].themeId && posts[i].themeId === posts[j].themeId
      if (similar(a, b)) {
        const swap = findSwap(posts, images, i, j)
        add('high', `${postLabelAt(posts, i)} and ${postLabelAt(posts, j)} look alike side by side`, [i, j], swap)
      } else if (sameTheme && j === i + 1 && i + 2 < posts.length && i % 3 === 0 && posts[i + 2].themeId === posts[i].themeId) {
        add('medium', `Row ${Math.floor(i / 3) + 1} is all one theme`, [i, i + 1, i + 2])
      }
    }
  }

  // Rows that are all dark or all bright.
  for (let r = 0; r + 2 < posts.length; r += 3) {
    const row = [0, 1, 2].map((k) => imgAt(r + k))
    if (row.some((x) => !x || !x.brightness)) continue
    if (row.every((x) => x.brightness < 28)) add('medium', `Row ${r / 3 + 1} is all dark`, [r, r + 1, r + 2])
    if (row.every((x) => x.brightness > 75)) add('medium', `Row ${r / 3 + 1} is all bright`, [r, r + 1, r + 2])
  }

  // Three of a kind in a row.
  for (let i = 0; i + 2 < posts.length; i++) {
    const f = posts[i].format
    if (posts[i + 1].format === f && posts[i + 2].format === f && f !== 'single') {
      add('medium', `Three ${f}s in a row (${postLabelAt(posts, i)}–${postLabelAt(posts, i + 2)})`, [i, i + 1, i + 2])
    }
  }

  // Pillar share against the brief.
  const pillars = (doc.brief?.pillars || []).filter((p) => p?.name && p.share)
  const filled = posts.filter((p) => p.slides.length)
  if (pillars.length && filled.length >= 6) {
    for (const p of pillars) {
      const count = filled.filter((x) => x.pillar === p.name).length
      const share = Math.round((count / filled.length) * 100)
      if (Math.abs(share - p.share) >= 20) {
        add('medium', `${p.name} is ${share}% of the plan — the brief asks for ${p.share}%`, [])
      }
    }
  }

  const seen = new Set()
  return issues.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)))
}

// The nearest post whose cover is unlike both neighbours of j.
function findSwap(posts, images, i, j) {
  const a = images.get(cover(posts[i]))
  for (let k = 0; k < posts.length; k++) {
    if (k === i || k === j || posts[k].locked || posts[j].locked) continue
    const c = images.get(cover(posts[k]))
    if (c && !similar(a, c)) return { from: j, to: k }
  }
  return null
}
