# KSS Studio

An Instagram planning studio for one creative director. It covers one loop: brief, photos, grid, graphics, captions, review, schedule, measure, and back into the next brief.

Live at **studio.kshetejsareen.com** once the domain is connected (see below).

## The steps

The left rail lists the steps in order. The bar at the bottom always names the next one.

| # | Step | What happens |
|---|------|--------------|
| 1 | **Brief** | Client, offer, goal, audience, voice, content pillars, theme kits and references. A completeness score shows what is missing. Research runs from here. |
| 2 | **Library** | Import photos (files, folders, Google Drive). Cull them, tag the subject and shot, and spot duplicates and near-duplicates. |
| 3 | **Plan** | A large phone-sized grid in the middle, with unused photos on the left and the selected post on the right. Drag photos onto cells, or onto a post to build a carousel. Used photos move to a separate "Used" section. Any post can get an A/B twin. Grid health flags look-alike neighbours, rows that are too dark or too bright, and pillar balance. |
| 4 | **Create** | Social graphics from a theme kit, exported to PNG. |
| 5 | **Write** | Captions per post, written against the brief. |
| 6 | **Review** | Every post with its checks: missing images, caption length, more than 5 hashtags, unexported designs, past times. Approve here. |
| 7 | **Schedule** | A calendar of approved posts. Auto-fill uses your posting slots (Mon/Wed/Fri 18:00 IST by default) and goes from the oldest grid post to the newest. Also exports an `.ics` calendar. |
| 8 | **Measure** | Instagram insights per post: save, share and engagement rates against your usual, 48-hour and 7-day snapshots, and A/B results. Learnings feed back into the brief. |
| — | **Promote** | Boost a post as an Instagram ad (Advantage+ or a manual audience). |
| — | **Settings** | Workspaces, keys (browser-only mode), posting slots, backups. |

### Scheduling has limits

Posts are published by the studio itself, every 30 seconds, from **one open tab**. The tab has to be open at the scheduled time. A post that gets cut off while publishing is flagged for a manual check, so it is never posted twice. No paid scheduling server is used.

## Two ways to run it

**Server mode (recommended).** `KSS_PASSCODE` is set on Vercel. Keys stay on the server. Each device enters the passcode once, and it is remembered for 30 days in an HttpOnly cookie. The browser never sees the Anthropic key or the Meta token.

**Browser-only mode.** `KSS_PASSCODE` is empty. Keys are typed into Settings and kept in this browser's storage. This mode is fine for local use, but anyone with access to the browser can read the keys.

Your work (posts, images, briefs) always lives in the browser's IndexedDB. Use **Settings → Backup** to export a `.kssb` file regularly, and to move work between devices.

## Environment variables

Copy `.env.example` to `.env.local` for local work. On Vercel, set them under Project → Settings → Environment Variables, for Production and Preview.

| Variable | Needed for |
|---|---|
| `KSS_PASSCODE` | Server mode. Make it long and random. |
| `KSS_SESSION_SECRET` | Optional. Changing it signs every device out. |
| `ANTHROPIC_API_KEY` | Claude: research, planning, captions, graphics. |
| `META_TOKEN` | Instagram publishing, insights and ads. Use a System User token so it does not expire. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Publishing. Instagram only accepts public image URLs. The free plan is enough. |
| `CHROME_PATH` | Local only. Used by the PNG export when it runs outside Vercel. |

## Domain: studio.kshetejsareen.com

1. In Vercel, go to Project → Settings → Domains and add `studio.kshetejsareen.com`.
2. Where the DNS for kshetejsareen.com is managed (Cloudflare), add a `CNAME` record with name `studio` and target `cname.vercel-dns.com`. Set the proxy status to **DNS only** (grey cloud), so that Vercel can issue the certificate.
3. Wait for Vercel to show the domain as valid. Use this one address from now on: storage belongs to the address, so work saved on a `*.vercel.app` preview URL does not show up on the domain. Move it across with a backup file.

## Architecture

```
src/
  App.jsx            shell, gates (loading, passcode, second tab), hash routing (#/plan)
  components/        shell (rail, top bar, next bar), ui kit, media tiles, icons
  steps/             one screen per step (Brief … Measure, Promote, Settings)
  store/             StoreProvider (state, autosave, session), selectors, in-tab scheduler
  lib/               pure logic: Claude requests, Meta Graph calls, insights, grid health,
                     checks, scheduling, ads targeting, ICS, Drive, Cloudinary, prompts
  data/              data model, IndexedDB, image storage, backups, migration from v2
api/                 Vercel functions (session-gated, same-origin only)
  session.js         passcode -> signed cookie
  claude.js          Claude proxy with an allow-list of models, tools and fields
  meta.js            Graph API proxy, limited to the endpoints the studio uses
  upload-sign.js     Cloudinary signed-upload parameters
  export-png.js      HTML -> PNG with headless Chrome (sanitised input)
  _lib/              shared helpers (not routed)
worker/              optional Cloudflare Worker proxy for browser-only mode
scripts/check-api.mjs  offline checks (no network, no keys)
```

The v2 data (`kss_*` keys in localStorage) is migrated into IndexedDB on first load. The old keys are left in place, untouched.

## Commands

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run check
```

`npm run dev` serves the app at http://localhost:5173 and runs the `api/` functions locally, reading `.env.local`.

`npm run check` tests sessions, the API allow-lists, the export sanitiser, and the planning, insights, scheduling and ads logic. It makes no network calls and needs no keys.

## Not included (on purpose)

- **TikTok.** It is banned in India, so the studio is Instagram-only.
- **Paid backends** (a hosted database, cron, or a scheduling service). These are skipped until the studio is fully in use. The free options are a single open tab for publishing, and backup files for syncing.
