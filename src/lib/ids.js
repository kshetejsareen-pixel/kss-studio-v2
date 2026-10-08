// Short random ids for posts, images, kits and workspaces.
export function uid(prefix = '') {
  let raw
  if (globalThis.crypto?.randomUUID) raw = crypto.randomUUID().replace(/-/g, '')
  else if (globalThis.crypto?.getRandomValues) {
    raw = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')
  } else raw = Math.random().toString(16).slice(2) + Date.now().toString(16)
  return prefix + raw.slice(0, 12)
}
