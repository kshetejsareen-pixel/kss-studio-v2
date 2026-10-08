// All scheduling happens in India Standard Time. IST has no daylight saving, so a fixed
// +05:30 offset is exact and the stored timestamps read the same on every device.
const OFFSET_MIN = 330
const OFFSET = '+05:30'
const pad = (n) => String(n).padStart(2, '0')
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function shifted(input) {
  const ms = input instanceof Date ? input.getTime() : new Date(input).getTime()
  if (!Number.isFinite(ms)) return null
  return new Date(ms + OFFSET_MIN * 60000)
}

// Calendar parts of a moment as seen in IST.
export function istParts(input = new Date()) {
  const d = shifted(input)
  if (!d) return null
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
    weekdayName: WEEKDAYS[d.getUTCDay()],
  }
}

export function toIstIso(input = new Date()) {
  const p = istParts(input)
  if (!p) return ''
  const d = shifted(input)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(d.getUTCSeconds())}${OFFSET}`
}

// <input type="datetime-local"> value -> stored IST timestamp
export function fromIstLocalInput(value) {
  if (!value) return ''
  return value.slice(0, 16) + ':00' + OFFSET
}

// stored timestamp -> <input type="datetime-local"> value in IST
export function toIstLocalInput(input) {
  if (!input) return ''
  const p = istParts(input)
  if (!p) return ''
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

// IST date (YYYY-MM-DD) for a moment.
export function istDateKey(input = new Date()) {
  const p = istParts(input)
  return p ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : ''
}

// Builds an IST timestamp from a YYYY-MM-DD date and hour/minute.
export function istAt(dateKey, hour, minute = 0) {
  return `${dateKey}T${pad(hour)}:${pad(minute)}:00${OFFSET}`
}

export function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function weekdayOf(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay()
}

export function formatIst(input, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (!Number.isFinite(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts }).format(d)
}

export function formatIstTime(input) {
  return formatIst(input, { hour: 'numeric', minute: '2-digit' })
}

export function hoursSince(input) {
  if (!input) return Infinity
  return (Date.now() - new Date(input).getTime()) / 3600000
}

export function relativeTime(input) {
  if (!input) return ''
  const diff = (Date.now() - new Date(input).getTime()) / 1000
  const abs = Math.abs(diff)
  const fmt = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`
  let text
  if (abs < 60) text = 'just now'
  else if (abs < 3600) text = fmt(Math.round(abs / 60), 'minute')
  else if (abs < 86400) text = fmt(Math.round(abs / 3600), 'hour')
  else text = fmt(Math.round(abs / 86400), 'day')
  if (text === 'just now') return text
  return diff >= 0 ? `${text} ago` : `in ${text}`
}
