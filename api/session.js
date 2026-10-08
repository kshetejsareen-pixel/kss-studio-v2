import { serverConfigured, isAuthed, checkPasscode, issueCookie, clearCookie, sameOrigin } from './_lib/session.js'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function features() {
  return {
    claude: !!process.env.ANTHROPIC_API_KEY,
    meta: !!process.env.META_TOKEN,
    cloudinary: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'GET') {
    if (!serverConfigured()) return res.status(200).json({ server: false })
    const authed = isAuthed(req)
    return res.status(200).json({
      server: true,
      authed,
      needsPasscode: !authed,
      features: authed ? features() : {},
    })
  }

  if (req.method === 'POST') {
    if (!serverConfigured()) return res.status(503).json({ error: 'Server is not configured.', code: 'config' })
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin request blocked.' })
    const passcode = req.body && typeof req.body === 'object' ? req.body.passcode : ''
    if (!checkPasscode(passcode)) {
      await wait(800)
      return res.status(401).json({ error: 'Wrong passcode.' })
    }
    issueCookie(req, res)
    return res.status(200).json({ server: true, authed: true, needsPasscode: false, features: features() })
  }

  if (req.method === 'DELETE') {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin request blocked.' })
    clearCookie(req, res)
    return res.status(200).json({ server: serverConfigured(), authed: false })
  }

  res.setHeader('Allow', 'GET, POST, DELETE')
  return res.status(405).json({ error: 'Method not allowed' })
}
