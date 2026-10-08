// Uploads a finished JPEG to Cloudinary so Instagram can fetch it from a public URL.
// With the server configured, uploads are signed there (the API secret stays on the
// server); otherwise an unsigned upload preset from Settings is used.
import { runtime, emit } from './runtime.js'

export function cloudinaryConfigured(settings) {
  return runtime.session.cloudMode === 'server' || !!(settings.cloudName && settings.cloudPreset)
}

export async function uploadImage(blob, { signal, filename = 'post.jpg' } = {}) {
  const form = new FormData()
  form.append('file', blob, filename)
  let cloud
  if (runtime.session.cloudMode === 'server') {
    let data = null
    let res
    try {
      res = await fetch('/api/upload-sign', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal,
      })
      data = await res.json().catch(() => null)
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      throw new Error('Could not reach the server to sign the upload.')
    }
    if (!res.ok || !data?.signature) {
      if (data?.code === 'session') emit('kss:unauthed')
      throw new Error(data?.error || `Could not sign the upload (${res.status}).`)
    }
    cloud = data.cloud_name
    form.append('api_key', data.api_key)
    form.append('timestamp', String(data.timestamp))
    form.append('signature', data.signature)
    form.append('folder', data.folder)
  } else {
    const { cloudName, cloudPreset } = runtime.settings
    if (!cloudName || !cloudPreset) throw new Error('Add a Cloudinary cloud name and unsigned upload preset in Settings.')
    cloud = cloudName
    form.append('upload_preset', cloudPreset)
  }

  let res
  let data = null
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, { method: 'POST', body: form, signal })
    data = await res.json().catch(() => null)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new Error('Could not reach Cloudinary — check your connection.')
  }
  if (!res.ok || !data?.secure_url) {
    throw new Error(data?.error?.message ? `Cloudinary: ${data.error.message}` : `Cloudinary upload failed (${res.status}).`)
  }
  return { url: data.secure_url, publicId: data.public_id, width: data.width, height: data.height }
}
