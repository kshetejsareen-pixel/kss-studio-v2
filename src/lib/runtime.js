// Non-React state that the library modules read: the current settings and how each
// connection is reached ('server' = Vercel functions hold the secrets, 'legacy' = keys
// typed into Settings and stored in this browser). The store keeps it in sync.
export const runtime = {
  settings: {},
  session: {
    server: false,
    authed: false,
    claudeMode: 'legacy',
    metaMode: 'legacy',
    cloudMode: 'legacy',
  },
}

export function setRuntimeSettings(settings) {
  runtime.settings = settings || {}
}

export function setRuntimeSession(session) {
  runtime.session = { ...runtime.session, ...session }
}

export function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function on(name, fn) {
  const handler = (e) => fn(e.detail)
  window.addEventListener(name, handler)
  return () => window.removeEventListener(name, handler)
}
