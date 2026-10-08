import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Runs the Vercel functions in api/ inside the Vite dev and preview servers, so local runs
// behave like production: same /api routes, same session cookie, same env vars (.env.local).
function kssApiDev() {
  return {
    name: 'kss-api-dev',
    configureServer(server) {
      server.middlewares.use(apiMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware)
    },
  }
}

async function apiMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost')
  const match = url.pathname.match(/^\/api\/([a-z-]+)$/)
  if (!match) return next()
  const file = path.resolve('api', `${match[1]}.js`)
  if (!fs.existsSync(file)) return next()

  req.query = Object.fromEntries(url.searchParams)
  try {
    req.body = await readJson(req)
  } catch (err) {
    res.statusCode = err.status || 400
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify({ error: err.message }))
  }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (data) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
    return res
  }
  res.send = (data) => {
    if (Buffer.isBuffer(data) || typeof data === 'string') res.end(data)
    else res.json(data)
    return res
  }
  try {
    const stamp = fs.statSync(file).mtimeMs
    const mod = await import(pathToFileURL(file).href + '?t=' + stamp)
    await mod.default(req, res)
  } catch (err) {
    console.error(`[api/${match[1]}]`, err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Dev server error: ' + err.message }))
    }
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(undefined)
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 5 * 1024 * 1024) {
        const err = new Error('Request body too large.')
        err.status = 413
        reject(err)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(undefined)
      const type = String(req.headers['content-type'] || '')
      if (!type.includes('json')) return resolve(raw)
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('Invalid JSON body.')) }
    })
    req.on('error', reject)
  })
}

// `vite preview` serves the same security headers as vercel.json so the CSP can be checked locally.
function vercelHeaders() {
  try {
    const conf = JSON.parse(fs.readFileSync('vercel.json', 'utf8'))
    const all = (conf.headers || []).find((h) => h.source === '/(.*)')
    return Object.fromEntries((all?.headers || []).map((h) => [h.key, h.value]))
  } catch {
    return {}
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v
  }
  return {
    plugins: [react(), kssApiDev()],
    preview: { headers: vercelHeaders() },
  }
})
