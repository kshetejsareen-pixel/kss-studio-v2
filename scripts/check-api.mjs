// Offline checks for the server functions and the pure logic the screens rely on.
// No network, no keys: every value below is a throwaway test value.
// Run with `npm run check`.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.KSS_PASSCODE = 'test-passcode-only-for-checks'
process.env.KSS_SESSION_SECRET = 'test-secret-only-for-checks'
delete process.env.ANTHROPIC_API_KEY

const results = []
async function test(name, fn) {
  try {
    await fn()
    results.push([true, name])
  } catch (err) {
    results.push([false, name, err])
  }
}

// ---- Request / response doubles --------------------------------------------------------

const HOST = 'studio.kshetejsareen.com'

function makeReq({ method = 'GET', headers = {}, body } = {}) {
  return { method, headers: { host: HOST, ...headers }, body }
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { res.statusCode = code; return res },
    json(data) { res.body = data; return res },
    send(data) { res.body = data; return res },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res },
    getHeader(k) { return res.headers[k.toLowerCase()] },
  }
  return res
}

const cookieFrom = (res) => String(res.headers['set-cookie'] || '').split(';')[0]

// ---- Modules ---------------------------------------------------------------------------------

const session = await import('../api/_lib/session.js')
const sessionApi = (await import('../api/session.js')).default
const claudeApi = await import('../api/claude.js')
const metaApi = await import('../api/meta.js')
const uploadApi = await import('../api/upload-sign.js')
const exportApi = await import('../api/export-png.js')

const { buildRequest, parseJson } = await import('../src/lib/api.js')
const { rates, verdict, compareTest, applyInsights } = await import('../src/lib/insights.js')
const { buildTargeting, charMeta } = await import('../src/lib/ads.js')
const { extractFolderId } = await import('../src/lib/drive.js')
const { buildIcs } = await import('../src/lib/ics.js')
const { briefCompleteness } = await import('../src/lib/brief.js')
const { gridHealth } = await import('../src/lib/health.js')
const { readPlan, applyPlan } = await import('../src/lib/studio.js')
const { postChecks, blocking } = await import('../src/lib/checks.js')
const { nextSlots, autoSchedule, orderProblems, slotStatus } = await import('../src/lib/schedule.js')
const model = await import('../src/data/model.js')
const { emptyDoc, emptyBrief, emptyAdDraft, newPost, newImage, slide, emptyKit } = model

// ---- Session --------------------------------------------------------------------------------

let goodCookie = ''

await test('session: GET without cookie reports a passcode is needed', async () => {
  const res = makeRes()
  await sessionApi(makeReq(), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { server: true, authed: false, needsPasscode: true, features: {} })
  assert.equal(res.headers['cache-control'], 'no-store')
})

await test('session: wrong passcode is refused and sets no cookie', async () => {
  const res = makeRes()
  await sessionApi(makeReq({ method: 'POST', body: { passcode: 'nope' } }), res)
  assert.equal(res.statusCode, 401)
  assert.equal(res.headers['set-cookie'], undefined)
})

await test('session: right passcode sets a Secure, HttpOnly, SameSite=Strict cookie', async () => {
  const res = makeRes()
  await sessionApi(makeReq({ method: 'POST', body: { passcode: process.env.KSS_PASSCODE } }), res)
  assert.equal(res.statusCode, 200)
  const c = String(res.headers['set-cookie'])
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/', 'Max-Age=2592000']) assert.ok(c.includes(part), `cookie lacks ${part}`)
  goodCookie = cookieFrom(res)
  assert.ok(goodCookie.startsWith('kss_session='))
})

await test('session: localhost cookie is not Secure (so dev works over http)', async () => {
  const res = makeRes()
  await sessionApi(makeReq({ method: 'POST', headers: { host: 'localhost:5173' }, body: { passcode: process.env.KSS_PASSCODE } }), res)
  assert.ok(!String(res.headers['set-cookie']).includes('Secure'))
})

await test('session: the issued cookie authenticates; features report server keys', async () => {
  const res = makeRes()
  await sessionApi(makeReq({ headers: { cookie: `other=1; ${goodCookie}` } }), res)
  assert.equal(res.body.authed, true)
  assert.equal(res.body.features.claude, false)
})

await test('session: tampered, forged and expired cookies are rejected', () => {
  const value = goodCookie.split('=')[1]
  const [exp, sig] = value.split('.')
  const tampered = `kss_session=${Number(exp) + 100}.${sig}`
  const forged = `kss_session=${exp}.${'A'.repeat(sig.length)}`
  const past = Math.floor(Date.now() / 1000) - 10
  const key = crypto.createHash('sha256').update('kss-session:' + process.env.KSS_SESSION_SECRET).digest()
  const expired = `kss_session=${past}.${crypto.createHmac('sha256', key).update(String(past)).digest('base64url')}`
  for (const cookie of [tampered, forged, expired, 'kss_session=', 'kss_session=abc']) {
    assert.equal(session.isAuthed(makeReq({ headers: { cookie } })), false, cookie)
  }
})

await test('session: cross-origin POST and DELETE are blocked with 403', async () => {
  for (const method of ['POST', 'DELETE']) {
    const res = makeRes()
    await sessionApi(makeReq({ method, headers: { origin: 'https://evil.example' }, body: { passcode: process.env.KSS_PASSCODE } }), res)
    assert.equal(res.statusCode, 403, method)
  }
})

await test('session: same-origin check compares host, and a bad Origin fails closed', () => {
  assert.equal(session.sameOrigin(makeReq({ headers: { origin: `https://${HOST}` } })), true)
  assert.equal(session.sameOrigin(makeReq({ headers: { origin: 'https://studio.kshetejsareen.com.evil.example' } })), false)
  assert.equal(session.sameOrigin(makeReq({ headers: { origin: 'not a url' } })), false)
  assert.equal(session.sameOrigin(makeReq()), true)
})

await test('session: DELETE clears the cookie', async () => {
  const res = makeRes()
  await sessionApi(makeReq({ method: 'DELETE' }), res)
  assert.ok(String(res.headers['set-cookie']).includes('Max-Age=0'))
})

await test('session: other methods get 405 with Allow', async () => {
  const res = makeRes()
  await sessionApi(makeReq({ method: 'PUT' }), res)
  assert.equal(res.statusCode, 405)
  assert.equal(res.headers.allow, 'GET, POST, DELETE')
})

// ---- Protected functions --------------------------------------------------------------------

await test('claude: needs a session (401), refuses cross-origin (403), GET is 405', async () => {
  let res = makeRes()
  await claudeApi.default(makeReq({ method: 'POST', body: {} }), res)
  assert.equal(res.statusCode, 401)
  res = makeRes()
  await claudeApi.default(makeReq({ method: 'POST', headers: { origin: 'https://evil.example', cookie: goodCookie }, body: {} }), res)
  assert.equal(res.statusCode, 403)
  res = makeRes()
  await claudeApi.default(makeReq({ method: 'GET' }), res)
  assert.equal(res.statusCode, 405)
})

await test('claude: signed in but no server key -> 503 config', async () => {
  const res = makeRes()
  await claudeApi.default(makeReq({ method: 'POST', headers: { cookie: goodCookie }, body: {} }), res)
  assert.equal(res.statusCode, 503)
  assert.equal(res.body.code, 'config')
})

await test('upload-sign: GET is 405, unsigned POST is 401', async () => {
  let res = makeRes()
  await uploadApi.default(makeReq({ method: 'GET' }), res)
  assert.equal(res.statusCode, 405)
  res = makeRes()
  await uploadApi.default(makeReq({ method: 'POST' }), res)
  assert.equal(res.statusCode, 401)
})

await test('upload-sign: signature is sha1 of sorted params + secret, and is returned without the secret', async () => {
  const sig = uploadApi.signParams({ timestamp: 1700000000, folder: 'kss-studio' }, 'shh')
  const want = crypto.createHash('sha1').update('folder=kss-studio&timestamp=1700000000shh').digest('hex')
  assert.equal(sig, want)
  Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: 'demo', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 'test-only' })
  const res = makeRes()
  await uploadApi.default(makeReq({ method: 'POST', headers: { cookie: goodCookie } }), res)
  assert.equal(res.statusCode, 200)
  assert.ok(!JSON.stringify(res.body).includes('test-only'))
  assert.equal(res.body.signature, uploadApi.signParams({ folder: 'kss-studio', timestamp: res.body.timestamp }, 'test-only'))
  for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[k]
})

await test('meta: only the endpoints the studio uses are reachable', () => {
  const ok = [['GET', '/me'], ['GET', '/me/accounts'], ['POST', '/178414/media'], ['POST', '/178414/media_publish'], ['GET', '/1784/insights'], ['POST', '/act_123/campaigns'], ['DELETE', '/123'], ['GET', '/debug_token']]
  const no = [['POST', '/me'], ['DELETE', '/act_123/campaigns'], ['GET', '/../me'], ['GET', '/me/accounts/extra'], ['POST', '/1784/insights'], ['GET', '/abc/media'], ['GET', 'https://graph.facebook.com/me'], ['GET', '/act_12/users']]
  for (const [m, p] of ok) assert.equal(metaApi.allowed(m, p), true, `${m} ${p}`)
  for (const [m, p] of no) assert.equal(metaApi.allowed(m, p), false, `${m} ${p}`)
})

await test('meta: a disallowed path is refused before any network call', async () => {
  process.env.META_TOKEN = 'test-only-token'
  const res = makeRes()
  await metaApi.default(makeReq({ method: 'POST', headers: { cookie: goodCookie }, body: { method: 'POST', path: '/me' } }), res)
  assert.equal(res.statusCode, 400)
  delete process.env.META_TOKEN
})

// ---- buildBody: the server-side allow-list ------------------------------------------------

const msg = [{ role: 'user', content: 'hi' }]

await test('buildBody: unknown fields are dropped (no beta headers, no metadata)', () => {
  const body = claudeApi.buildBody({ model: 'claude-sonnet-5', messages: msg, metadata: { x: 1 }, betas: ['x'], 'anthropic-beta': 'x', stream: true, temperature: 1 })
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model'])
})

await test('buildBody: rejects unknown models, tools, roles and image sources', () => {
  const bad = [
    { model: 'gpt-4', messages: msg },
    { model: 'claude-sonnet-5', messages: [] },
    { model: 'claude-sonnet-5', messages: [{ role: 'system', content: 'x' }] },
    { model: 'claude-sonnet-5', messages: msg, tools: [{ type: 'bash_20250124' }] },
    { model: 'claude-sonnet-5', messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://x' } }] }] },
    { model: 'claude-sonnet-5', messages: [{ role: 'assistant', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } }] }] },
    { model: 'claude-sonnet-5', messages: msg, output_config: { effort: 'ultra' } },
    { model: 'claude-sonnet-5', messages: msg, thinking: { type: 'enabled', budget_tokens: 1000 } },
    { model: 'claude-opus-5-5', messages: msg, thinking: { type: 'disabled' } },
    { model: 'claude-haiku-4-5', messages: msg, tools: [{ type: 'web_search_20260209' }] },
  ]
  for (const input of bad) assert.throws(() => claudeApi.buildBody(input), undefined, JSON.stringify(input).slice(0, 90))
})

await test('buildBody: clamps max_tokens and tool uses; strips Haiku-only-unsupported options', () => {
  const big = claudeApi.buildBody({ model: 'claude-sonnet-5', messages: msg, max_tokens: 999999, tools: [{ type: 'web_search_20260209', max_uses: 99 }] })
  assert.equal(big.max_tokens, 16000)
  assert.deepEqual(big.tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10 }])
  const h = claudeApi.buildBody({ model: 'claude-haiku-4-5', messages: msg, max_tokens: 10, thinking: { type: 'adaptive' }, effort: 'high' })
  assert.equal(h.max_tokens, 64)
  assert.equal(h.thinking, undefined)
  assert.equal(h.output_config, undefined)
})

await test('buildRequest -> buildBody: every request shape the app sends is accepted unchanged', () => {
  const shapes = [
    { model: 'claude-sonnet-5', prompt: 'x' },
    { model: 'claude-opus-5', prompt: 'x', effort: 'high', thinking: 'adaptive' },
    { model: 'claude-opus-5', prompt: 'x', effort: 'max', thinking: 'disabled' },
    { model: 'claude-opus-5-5', prompt: 'x', thinking: 'disabled', maxTokens: 1500 },
    { model: 'claude-sonnet-5', prompt: 'x', search: 5, fetch: true },
    { model: 'claude-haiku-4-5', prompt: 'x', search: 2, effort: 'low', thinking: 'disabled', fetch: true },
    { model: 'claude-sonnet-5', prompt: 'x', images: ['data:image/jpeg;base64,AAAA'] },
  ]
  for (const s of shapes) {
    const req = buildRequest(s)
    assert.deepEqual(claudeApi.buildBody(req), req, JSON.stringify(s))
  }
})

await test('buildRequest: Opus 5.5 never sends disabled thinking; Haiku gets the basic search tool', () => {
  const o = buildRequest({ model: 'claude-opus-5-5', prompt: 'x', thinking: 'disabled', maxTokens: 1500 })
  assert.equal(o.thinking, undefined)
  assert.ok(o.max_tokens >= 4000)
  const h = buildRequest({ model: 'claude-haiku-4-5', prompt: 'x', search: 2, fetch: true })
  assert.deepEqual(h.tools.map((t) => t.type), ['web_search_20250305'])
})

await test('parseJson: reads fenced, wrapped and bare JSON; throws on prose', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJson('Here you go:\n```\n[1,2]\n```\nThanks'), [1, 2])
  assert.deepEqual(parseJson('Sure! {"a":{"b":2}} hope that helps'), { a: { b: 2 } })
  assert.deepEqual(parseJson('[{"x":1}]'), [{ x: 1 }])
  assert.throws(() => parseJson('no json here'))
  assert.throws(() => parseJson(''))
})

// ---- Export sanitiser -------------------------------------------------------------------------

await test('export sanitize: strips scripts, frames, handlers, meta refresh and javascript: URLs', () => {
  const dirty = `<div onclick="x()"><script>alert(1)</script><SCRIPT src=x></SCRIPT><script src="y"/>
    <img src=x onerror=alert(1)><iframe src="https://evil"></iframe><object data=x></object>
    <meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil/">
    <a href="javascript:alert(1)">a</a><a href='JaVaScRiPt:void(0)'>b</a><p>keep</p></div>`
  const clean = exportApi.sanitize(dirty)
  for (const bad of [/<script/i, /onerror/i, /onclick/i, /<iframe/i, /<object/i, /<meta/i, /<base/i, /javascript:/i]) {
    assert.ok(!bad.test(clean), `left ${bad} in: ${clean}`)
  }
  assert.ok(clean.includes('<p>keep</p>'))
})

await test('export: GET is 405 and an empty body is 400', async () => {
  let res = makeRes()
  await exportApi.default(makeReq({ method: 'GET' }), res)
  assert.equal(res.statusCode, 405)
  res = makeRes()
  await exportApi.default(makeReq({ method: 'POST', headers: { cookie: goodCookie }, body: {} }), res)
  assert.equal(res.statusCode, 400)
})

// ---- Insights -------------------------------------------------------------------------------

await test('rates: per-reach ratios, nulls for metrics Instagram did not return', () => {
  const r = rates({ reach: 200, saved: 10, shares: 4, total_interactions: 30, profile_visits: 2, follows: 1 })
  assert.equal(r.saveRate, 0.05)
  assert.equal(r.shareRate, 0.02)
  assert.equal(r.engagementRate, 0.15)
  assert.equal(r.followsPer1k, 5)
  assert.equal(r.views, null)
  assert.equal(rates({ reach: 0, saved: 3 }).saveRate, 0)
  assert.equal(rates({ reach: 10 }).saveRate, null)
  assert.equal(rates(null), null)
})

await test('verdict: ±20% band around the usual', () => {
  assert.equal(verdict(1.2, 1), 'above')
  assert.equal(verdict(0.8, 1), 'below')
  assert.equal(verdict(1.1, 1), 'typical')
  assert.equal(verdict(1, 0), null)
  assert.equal(verdict(null, 1), null)
})

await test('compareTest: waiting, tie within 10%, and a winner', () => {
  const rows = (a, b) => new Map([['A', { rates: { saveRate: a } }], ['B', { rates: { saveRate: b } }]])
  const t = { aPostId: 'A', bPostId: 'B', metric: 'saveRate' }
  assert.equal(compareTest(t, rows(0.05, null)).status, 'waiting')
  assert.equal(compareTest(t, rows(0.05, 0.054)).status, 'tie')
  assert.equal(compareTest(t, rows(0.05, 0.08)).status, 'b')
  assert.equal(compareTest(t, rows(0.08, 0.05)).status, 'a')
  assert.equal(compareTest(t, rows(0, 0.01)).status, 'b')
})

await test('applyInsights: stores latest, fills the 48h snapshot once, leaves 7d empty until due', () => {
  const doc = emptyDoc()
  const publishedAt = new Date(Date.now() - 72 * 3600e3).toISOString()
  const post = newPost({ publish: { igMediaId: 'm1', publishedAt } })
  const other = newPost()
  doc.posts = [post, other]
  const at = new Date().toISOString()
  const out = applyInsights(doc, { fetchedAt: at, at, items: [{ id: 'm1', timestamp: publishedAt }, { id: 'm2' }], results: { m1: { reach: 120, saved: 6 } } })
  const m = out.posts[0].metrics
  assert.equal(m.latest.reach, 120)
  assert.equal(m.latest.ageHours, 72)
  assert.equal(m.h48.reach, 120)
  assert.equal(m.d7, null)
  assert.equal(out.posts[1], other)
  assert.equal(out.feed.items[0].metrics.reach, 120)
  assert.equal(out.feed.items[1].metrics, undefined)
  // A later sync must not overwrite the 48h snapshot.
  const later = applyInsights(out, { fetchedAt: at, at, items: [], results: { m1: { reach: 500 } } })
  assert.equal(later.posts[0].metrics.h48.reach, 120)
  assert.equal(later.posts[0].metrics.latest.reach, 500)
})

// ---- Ads -------------------------------------------------------------------------------------

await test('buildTargeting: Advantage+ keeps location, relaxes age and drops interests', () => {
  const draft = emptyAdDraft()
  draft.advPlus = true
  draft.targeting = { ...draft.targeting, ageMin: 30, ageMax: 45, genders: [2] }
  const t = buildTargeting(draft, { cities: [{ key: '1035921' }], interests: [{ id: '6003', name: 'Photography' }] })
  assert.equal(t.age_min, 25)
  assert.equal(t.age_max, 65)
  assert.equal(t.flexible_spec, undefined)
  assert.equal(t.targeting_automation.advantage_audience, 1)
  assert.deepEqual(t.geo_locations.cities, [{ key: '1035921', radius: 25, distance_unit: 'kilometer' }])
  assert.deepEqual(t.genders, [2])
  assert.deepEqual(t.publisher_platforms, ['instagram'])
})

await test('buildTargeting: manual audience keeps ages and interests; defaults to India', () => {
  const draft = emptyAdDraft()
  draft.advPlus = false
  draft.placement = 'story'
  draft.targeting = { ...draft.targeting, ageMin: 30, ageMax: 45, country: '' }
  const t = buildTargeting(draft, { interests: [{ id: '6003', name: 'Photography' }] })
  assert.equal(t.age_min, 30)
  assert.equal(t.age_max, 45)
  assert.deepEqual(t.geo_locations, { countries: ['IN'] })
  assert.deepEqual(t.flexible_spec, [{ interests: [{ id: '6003', name: 'Photography' }] }])
  assert.deepEqual(t.instagram_positions, ['story'])
})

await test('charMeta: ok, near (over 88%) and over the limit', () => {
  assert.equal(charMeta('x'.repeat(10), 125).tone, 'ok')
  assert.equal(charMeta('x'.repeat(120), 125).tone, 'near')
  const over = charMeta('x'.repeat(126), 125)
  assert.equal(over.tone, 'over')
  assert.equal(over.over, true)
  assert.equal(charMeta(null, 40).len, 0)
})

// ---- Drive, calendar, brief ------------------------------------------------------------------

await test('extractFolderId: folder links, open?id= links, bare ids; rejects junk', () => {
  const id = '1AbC_dEf-GhIjKlMnOp'
  assert.equal(extractFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`), id)
  assert.equal(extractFolderId(`https://drive.google.com/drive/u/1/folders/${id}`), id)
  assert.equal(extractFolderId(`https://drive.google.com/open?id=${id}`), id)
  assert.equal(extractFolderId(`  ${id}  `), id)
  assert.equal(extractFolderId('hello'), null)
  assert.equal(extractFolderId(''), null)
})

await test('buildIcs: one event per scheduled post, UTC times, escaped text, CRLF, folded lines', () => {
  const doc = emptyDoc()
  doc.themes = [emptyKit({ name: 'Quiet, light' }, [])]
  doc.posts = [
    newPost({ schedule: { at: '2026-10-09T18:00:00+05:30' }, themeId: doc.themes[0].id, caption: { text: 'Line one; with a comma, and\nsecond line ' + 'x'.repeat(200) } }),
    newPost(),
    newPost({ schedule: { at: 'not a date' } }),
  ]
  const ics = buildIcs(doc)
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1)
  assert.ok(ics.includes('DTSTART:20261009T123000Z'))
  assert.ok(ics.includes('Quiet\\, light'))
  assert.ok(ics.includes('Line one\\; with a comma\\, and\\nsecond'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.ok(!/[^\r]\n/.test(ics), 'bare LF found')
  for (const l of ics.split('\r\n')) assert.ok(l.length <= 75, `line too long: ${l.length}`)
})

await test('briefCompleteness: empty brief scores 0 and lists 8 gaps; a full one scores 100', () => {
  const empty = briefCompleteness(emptyBrief())
  assert.equal(empty.score, 0)
  assert.equal(empty.missing.length, 8)
  const full = briefCompleteness({
    ...emptyBrief(), client: 'KSS', offer: 'Photography', goal: 'Leads', voice: 'Calm', dos: 'Natural light', cta: 'Book a shoot',
    pillars: [{ name: 'Work', share: 60 }], audience: { ...emptyBrief().audience, locations: ['Delhi'] },
  })
  assert.equal(full.score, 100)
  assert.deepEqual(full.missing, [])
})

// ---- Plan -------------------------------------------------------------------------------------

function planDoc() {
  const doc = emptyDoc()
  doc.images = Array.from({ length: 9 }, (_, i) => newImage({ id: `i${i}`, name: `${i}.jpg`, width: 1080, height: 1350, brightness: 50 }))
  return doc
}

await test('gridHealth: flags look-alike neighbours (with a swap), three carousels in a row and empty posts', () => {
  const doc = planDoc()
  doc.images[1] = { ...doc.images[1], dupOf: 'i0' }
  doc.posts = [
    newPost({ slides: [slide('i0')] }),
    newPost({ slides: [slide('i1')] }),
    newPost({ slides: [slide('i2'), slide('i3')], format: 'carousel' }),
    newPost({ slides: [slide('i4'), slide('i5')], format: 'carousel' }),
    newPost({ slides: [slide('i6'), slide('i7')], format: 'carousel' }),
    newPost(),
  ]
  const issues = gridHealth(doc)
  const alike = issues.find((x) => x.severity === 'high' && /look alike/.test(x.text))
  assert.ok(alike, 'no look-alike issue')
  assert.deepEqual(alike.indices, [0, 1])
  assert.equal(alike.posts[0], 'P6')
  assert.ok(alike.swap && alike.swap.from === 1)
  assert.ok(issues.some((x) => /Three carousels in a row/.test(x.text)))
  assert.ok(issues.some((x) => /P1 is empty/.test(x.text)))
  assert.equal(new Set(issues.map((x) => x.id)).size, issues.length)
})

await test('readPlan: accepts 0-based answers, drops repeats and bad indices, pads to the slot count', () => {
  const imgs = planDoc().images
  const items = readPlan([{ imageIndex: 0 }, { slides: [1, 2, 1, 99], type: 'carousel', theme: 'Quiet' }, { imageIndex: 0 }], imgs, 4)
  assert.equal(items.length, 4)
  assert.deepEqual(items[0].ids, ['i0'])
  assert.deepEqual(items[1].ids, ['i1', 'i2'])
  assert.equal(items[1].type, 'carousel')
  assert.deepEqual(items[2].ids, [])
  assert.deepEqual(items[3], { ids: [], type: 'single', theme: '', notes: '' })
  assert.deepEqual(readPlan('nonsense', imgs, 2).map((x) => x.ids), [[], []])
})

await test('applyPlan: writes into open slots only, sets carousel format and links themes by name', () => {
  const doc = planDoc()
  doc.themes = [emptyKit({ name: 'Quiet' }, [])]
  const locked = newPost({ locked: true, slides: [slide('i8')] })
  doc.posts = [newPost(), locked, newPost({ format: 'carousel', slides: [slide('i3'), slide('i4')] })]
  const slots = [{ post: doc.posts[0], index: 0 }, { post: doc.posts[2], index: 2 }]
  const posts = applyPlan(doc, slots, [{ ids: ['i1', 'i2'], type: 'carousel', theme: 'quiet', notes: '' }, { ids: ['i5'], type: 'single', theme: 'Moody', notes: '' }])
  assert.equal(posts[1], locked)
  assert.equal(posts[0].format, 'carousel')
  assert.equal(posts[0].themeId, doc.themes[0].id)
  assert.equal(posts[2].format, 'single')
  assert.equal(posts[2].notes, 'Moody')
  assert.deepEqual(posts[2].slides.map((s) => s.imageId), ['i5'])
})

// ---- Review checks ------------------------------------------------------------------------

await test('postChecks: empty post and over-limit captions block; a clean post passes', () => {
  const doc = planDoc()
  const empty = postChecks(newPost(), doc)
  assert.ok(empty.some((c) => c.id === 'images' && c.level === 'error'))
  assert.ok(blocking(empty))

  const long = newPost({ slides: [slide('i0')], caption: { ...newPost().caption, text: 'x'.repeat(2201), hashtags: '#a #b #c #d', approved: true } })
  long.caption.text += ' #e #f'
  const checks = postChecks(long, doc)
  assert.ok(checks.some((c) => c.id === 'length' && c.level === 'error'))
  assert.ok(checks.some((c) => c.id === 'hashtags' && c.level === 'error'))

  const ok = newPost({ slides: [slide('i0')], caption: { ...newPost().caption, text: 'A calm frame.', hashtags: '#kss', approved: true } })
  assert.deepEqual(postChecks(ok, doc), [])
})

await test('postChecks: deleted images, carousel with one slide, unexported design and past times', () => {
  const doc = planDoc()
  const p = newPost({
    format: 'carousel', slides: [slide('gone')], design: { html: '<div/>', exportImageId: null },
    caption: { ...newPost().caption, text: 'x', approved: true }, schedule: { at: '2020-01-01T10:00:00+05:30' },
  })
  const ids = postChecks(p, doc).map((c) => c.id)
  for (const id of ['missing', 'format', 'design', 'past']) assert.ok(ids.includes(id), id)
})

// ---- Schedule -----------------------------------------------------------------------------

// Thursday 8 Oct 2026, 10:00 IST.
const THU = new Date('2026-10-08T10:00:00+05:30')
const SLOTS = { weekdays: [1, 3, 5], hour: 18, minute: 0 }

await test('nextSlots: Mon/Wed/Fri at 18:00 IST, skipping busy days and too-soon times', () => {
  assert.deepEqual(nextSlots(SLOTS, 3, { from: THU }), ['2026-10-09T18:00:00+05:30', '2026-10-12T18:00:00+05:30', '2026-10-14T18:00:00+05:30'])
  assert.deepEqual(nextSlots(SLOTS, 1, { from: THU, taken: ['2026-10-09T09:00:00+05:30'] }), ['2026-10-12T18:00:00+05:30'])
  assert.deepEqual(nextSlots(SLOTS, 1, { from: new Date('2026-10-09T17:45:00+05:30') }), ['2026-10-12T18:00:00+05:30'])
  assert.deepEqual(nextSlots({ weekdays: [] }, 3, { from: THU }), [])
})

await test('autoSchedule: oldest grid post (last in the array) goes out first; unapproved posts wait', () => {
  const a = newPost({ id: 'newest', approved: true })
  const b = newPost({ id: 'oldest', approved: true })
  const c = newPost({ id: 'draft' })
  const plan = autoSchedule([a, b, c], SLOTS, { from: THU })
  assert.deepEqual(plan, { oldest: '2026-10-09T18:00:00+05:30', newest: '2026-10-12T18:00:00+05:30' })
})

await test('orderProblems: flags a newer post scheduled before an older one', () => {
  const at = (s) => ({ at: s })
  const wrong = [newPost({ id: 'n', schedule: at('2026-10-09T18:00:00+05:30') }), newPost({ id: 'o', schedule: at('2026-10-12T18:00:00+05:30') })]
  assert.deepEqual(orderProblems(wrong), ['n'])
  const right = [newPost({ id: 'n', schedule: at('2026-10-12T18:00:00+05:30') }), newPost({ id: 'o', schedule: at('2026-10-09T18:00:00+05:30') })]
  assert.deepEqual(orderProblems(right), [])
})

await test('slotStatus: published, error, unapproved, due and scheduled', () => {
  const now = Date.parse('2026-10-10T00:00:00Z')
  assert.equal(slotStatus(newPost({ publish: { igMediaId: '1' } }), { now }), 'published')
  assert.equal(slotStatus(newPost({ approved: true, publish: { error: 'x' } }), { now }), 'error')
  assert.equal(slotStatus(newPost({ schedule: { at: '2026-10-12T18:00:00+05:30' } }), { now }), 'unapproved')
  assert.equal(slotStatus(newPost({ approved: true, schedule: { at: '2026-10-09T18:00:00+05:30' } }), { now }), 'due')
  assert.equal(slotStatus(newPost({ approved: true, schedule: { at: '2026-10-12T18:00:00+05:30' } }), { now }), 'scheduled')
})

// ---- Repo hygiene -----------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(m?js|jsx)$/.test(name)) out.push(p)
  }
  return out
}

await test('hygiene: no hard-coded keys anywhere; no beta headers from the app or Vercel functions', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'api')), ...walk(join(root, 'worker'))]) {
    const text = readFileSync(file, 'utf8')
    // The optional Cloudflare worker adds the documented fallback beta on purpose (FALLBACKS=off disables it).
    if (!file.includes(`${join('', 'worker')}/`)) assert.ok(!/anthropic-beta/i.test(text), `${file} sends anthropic-beta`)
    assert.ok(!/sk-ant-[a-z0-9]{8,}/i.test(text), `${file} contains an Anthropic key`)
    assert.ok(!/EAA[A-Za-z0-9]{40,}/.test(text), `${file} contains a Meta token`)
  }
})

await test('hygiene: vercel.json ships a CSP that blocks framing and foreign scripts', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const all = (cfg.headers || []).flatMap((h) => h.headers || [])
  const csp = all.find((h) => h.key.toLowerCase() === 'content-security-policy')?.value || ''
  assert.ok(/frame-ancestors 'none'/.test(csp), 'frame-ancestors')
  assert.ok(/script-src 'self'(;|$)/.test(csp), 'script-src')
})

// ---- Report -------------------------------------------------------------------------------------

const failed = results.filter(([ok]) => !ok)
for (const [ok, name, err] of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (!ok) console.log('     ' + String(err?.message || err).split('\n').join('\n     '))
}
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
