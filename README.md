# KSS Studio v2

Kshetej Sareen Studios — Instagram content planning and design tool.
Built with React + Vite. Deploys to Vercel.

## Setup (one time)

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to vercel.com → Add New Project → Import this repo
3. Vercel auto-detects Vite — just click Deploy
4. Every push to main auto-deploys

## Architecture

Each tab is an isolated React component:
- `src/components/PlanTab.jsx` — visual layout planner
- `src/components/StudioTab.jsx` — AI design generation
- `src/components/CaptionsTab.jsx` — caption writing
- `src/components/ScheduleTab.jsx` — queue and publish
- `src/components/SettingsTab.jsx` — API keys and settings

Global state lives in `src/store.jsx`.
API calls live in `src/store.jsx` — claudeCall, claudeVision, claudeResearch.
Design tokens (colours, fonts, spacing) live in `src/styles/globals.css`.

## Cloudflare Proxy

API calls go through: `https://kss-proxy.kshetej-sareen.workers.dev`
This keeps the Anthropic API key secure.
