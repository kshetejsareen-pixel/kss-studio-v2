// Signs a Cloudinary upload so the API secret never reaches the browser.
// The browser uploads the file straight to Cloudinary with this signature.
import crypto from 'node:crypto'
import { requireSession } from './_lib/session.js'

const FOLDER = 'kss-studio'

export function signParams(params, secret) {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return crypto.createHash('sha1').update(toSign + secret).digest('hex')
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!requireSession(req, res)) return
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env
  if (!cloud || !key || !secret) {
    return res.status(503).json({ error: 'Cloudinary is not configured on the server.', code: 'config' })
  }
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signParams({ folder: FOLDER, timestamp }, secret)
  return res.status(200).json({ timestamp, signature, api_key: key, cloud_name: cloud, folder: FOLDER })
}
