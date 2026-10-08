// The brief as prompt context. Every Claude call that writes or plans for the client
// starts from this block, so changing the brief changes every downstream step.

const line = (label, value) => {
  const v = String(value ?? '').trim()
  return v ? `${label}: ${v}` : ''
}

export function audienceText(a = {}) {
  const parts = []
  if (a.summary) parts.push(a.summary.trim())
  if (a.ageMin || a.ageMax) parts.push(`ages ${a.ageMin || 18}–${a.ageMax || 65}`)
  if (a.genders?.length) parts.push(a.genders.join(' / '))
  if (a.locations?.length) parts.push(`in ${a.locations.join(', ')}`)
  if (a.interests?.length) parts.push(`interested in ${a.interests.join(', ')}`)
  return parts.join('; ')
}

export function pillarsText(pillars = []) {
  return pillars
    .filter((p) => p?.name)
    .map((p) => (p.share ? `${p.name} (${p.share}%)` : p.name) + (p.desc ? ` — ${p.desc}` : ''))
    .join('; ')
}

export function briefContext(doc, { research = true, learnings = true, themeId = null } = {}) {
  const b = doc.brief || {}
  const out = [
    line('CLIENT', b.client),
    line('OFFER', b.offer),
    line('GOAL', [(b.goals || []).join('; '), b.goal].filter(Boolean).join(' — ')),
    line('AUDIENCE', [b.target, audienceText(b.audience)].filter(Boolean).join(' — ')),
    line('VOICE', b.voice),
    line('PILLARS', pillarsText(b.pillars)),
    line('DO', b.dos),
    line("DON'T", b.donts),
    line('CTA', b.cta),
    line('COMPETITORS AND BRANDS TO WATCH', b.competitors),
    line('READING', (b.reading || []).map((r) => r.title + (r.note ? ` (${r.note})` : '')).join('; ')),
  ]
  const kit = themeId ? doc.themes.find((k) => k.id === themeId) : null
  if (kit) {
    out.push(line('THEME', [
      kit.name,
      kit.intent,
      kit.mood && `mood ${kit.mood}`,
      kit.light && `light ${kit.light}`,
      kit.captionTone && `caption tone ${kit.captionTone}`,
      kit.notThis && `not ${kit.notThis}`,
    ].filter(Boolean).join(' · ')))
  }
  if (research && doc.research?.useInPrompts && doc.research.text) {
    out.push(`RESEARCH:\n${doc.research.text.slice(0, 1500)}`)
  }
  if (learnings) {
    const active = (doc.learnings || []).filter((l) => l.active).slice(0, 6)
    if (active.length) out.push(`LEARNINGS FROM PAST POSTS:\n${active.map((l) => `- ${l.text}`).join('\n')}`)
  }
  return out.filter(Boolean).join('\n')
}

const CHECKS = [
  ['client', 'Client or brand', (b) => b.client],
  ['offer', 'What you sell', (b) => b.offer],
  ['goal', 'Goal', (b) => b.goals?.length || b.goal],
  ['audience', 'Audience', (b) => b.target || b.audience?.summary || b.audience?.locations?.length || b.audience?.interests?.length],
  ['voice', 'Voice', (b) => b.voice],
  ['pillars', 'Content pillars', (b) => b.pillars?.some((p) => p?.name)],
  ['dos', 'Do / don’t', (b) => b.dos || b.donts],
  ['cta', 'Call to action', (b) => b.cta],
]

export function briefCompleteness(brief = {}) {
  const missing = CHECKS.filter(([, , ok]) => !ok(brief)).map(([key, label]) => ({ key, label }))
  return { score: Math.round(((CHECKS.length - missing.length) / CHECKS.length) * 100), missing }
}
