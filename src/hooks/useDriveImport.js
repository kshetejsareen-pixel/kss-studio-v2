import { useState, useCallback } from 'react'
import { getImageOrientation } from '../store.jsx'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'

function extractFolderId(url) {
  if (!url) return null
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  if (/^[a-zA-Z0-9_-]{10,}$/.test(url.trim())) return url.trim()
  return null
}

async function fetchFolderImages(folderId, apiKey) {
  const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/tiff']
  const mimeQuery = imageTypes.map(t => `mimeType='${t}'`).join(' or ')
  const query = encodeURIComponent(`'${folderId}' in parents and (${mimeQuery}) and trashed=false`)
  const fields = encodeURIComponent('files(id,name,mimeType,imageMediaMetadata)')
  const url = `${DRIVE_API}/files?q=${query}&fields=${fields}&pageSize=200&key=${apiKey}`
  const r = await fetch(url)
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    const msg = e.error?.message || `HTTP ${r.status}`
    if (r.status === 403) throw new Error('API key not authorised for Drive API')
    if (r.status === 404) throw new Error('Folder not found — check URL and sharing settings')
    throw new Error(msg)
  }
  const d = await r.json()
  return d.files || []
}

async function loadDriveImage(fileId, apiKey) {
  // Use thumbnail URL — no CORS issues, works in browser
  // sz=w1600 gives high enough quality for planning
  const thumbUrl = `https://lh3.googleusercontent.com/d/${fileId}=w1600`
  
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      // Draw to canvas to get base64
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      } catch {
        // If canvas tainted, just use the URL directly as dataUrl substitute
        resolve(thumbUrl)
      }
    }
    img.onerror = () => {
      // Fallback to drive thumbnail
      const fallback = `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`
      const img2 = new Image()
      img2.onload = () => resolve(fallback)
      img2.onerror = () => reject(new Error(`Cannot load image ${fileId}`))
      img2.src = fallback
    }
    img.src = thumbUrl
  })
}

function getImageDimensions(dataUrl) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 800, h: 1000 })
    img.src = dataUrl
  })
}

export function useDriveImport({ apiKey, onImport, showToast }) {
  const [folders, setFolders] = useState([])
  const [folderInput, setFolderInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')

  const addFolder = useCallback(() => {
    const url = folderInput.trim()
    if (!url) return
    const id = extractFolderId(url)
    if (!id) { showToast('Invalid Drive folder URL'); return }
    if (folders.find(f => f.id === id)) { showToast('Folder already added'); return }
    setFolders(prev => [...prev, { url, id, name: id.substring(0, 12) + '…', status: 'idle' }])
    setFolderInput('')
    showToast('Folder added — click Browse All to load images')
  }, [folderInput, folders, showToast])

  const removeFolder = useCallback((id) => {
    setFolders(prev => prev.filter(f => f.id !== id))
  }, [])

  const browseAll = useCallback(async () => {
    if (!apiKey) { showToast('Add Google API key in Settings first'); return }
    if (!folders.length) { showToast('Add at least one folder first'); return }
    setLoading(true)
    const allImages = []

    for (const folder of folders) {
      setProgress(`Scanning folder…`)
      setFolders(prev => prev.map(f => f.id === folder.id ? { ...f, status: 'loading' } : f))
      try {
        const files = await fetchFolderImages(folder.id, apiKey)
        setProgress(`Found ${files.length} images — loading…`)
        const batchSize = 3
        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize)
          setProgress(`Loading ${i + 1}–${Math.min(i + batchSize, files.length)} of ${files.length}…`)
          const results = await Promise.allSettled(
            batch.map(async file => {
              const dataUrl = await loadDriveImage(file.id, apiKey)
              const { w, h } = await getImageDimensions(dataUrl)
              return {
                id: 'drive_' + file.id,
                name: file.name,
                dataUrl,
                width: w,
                height: h,
                orientation: getImageOrientation(w, h),
                driveId: file.id,
              }
            })
          )
          results.forEach(r => { if (r.status === 'fulfilled') allImages.push(r.value) })
        }
        setFolders(prev => prev.map(f =>
          f.id === folder.id ? { ...f, status: 'done', count: allImages.length } : f
        ))
      } catch (e) {
        setFolders(prev => prev.map(f =>
          f.id === folder.id ? { ...f, status: 'error', error: e.message } : f
        ))
        showToast(`Error: ${e.message}`)
      }
    }

    setLoading(false)
    setProgress('')
    if (allImages.length) {
      onImport(allImages)
      showToast(`${allImages.length} images loaded ✓`)
    } else {
      showToast('No images could be loaded — check folder sharing settings')
    }
  }, [apiKey, folders, onImport, showToast])

  return { folders, folderInput, setFolderInput, addFolder, removeFolder, browseAll, loading, progress }
}
