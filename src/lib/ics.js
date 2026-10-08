// Calendar export: one 15-minute event per scheduled post, so the plan shows up in any
// calendar app as a reminder alongside the in-app scheduler.
import { postLabelAt, formatLabel } from '../data/model.js'

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n')

function fold(lineText) {
  const out = []
  let s = lineText
  while (s.length > 73) {
    out.push(s.slice(0, 73))
    s = ' ' + s.slice(73)
  }
  out.push(s)
  return out.join('\r\n')
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function buildIcs(doc) {
  const now = stamp(new Date())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KSS Studio//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  doc.posts.forEach((p, i) => {
    if (!p.schedule?.at) return
    const at = new Date(p.schedule.at)
    if (Number.isNaN(at.getTime())) return
    const theme = doc.themes.find((k) => k.id === p.themeId)?.name
    const summary = [postLabelAt(doc.posts, i), formatLabel(p.format).toLowerCase(), theme].filter(Boolean).join(' · ')
    const desc = [p.caption?.text?.slice(0, 300), p.notes].filter(Boolean).join('\n\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${p.id}@kss-studio`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(at)}`,
      'DURATION:PT15M',
      fold(`SUMMARY:${esc(summary)}`),
    )
    if (desc) lines.push(fold(`DESCRIPTION:${esc(desc)}`))
    lines.push('END:VEVENT')
  })
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
