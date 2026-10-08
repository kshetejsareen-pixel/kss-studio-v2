// Only one tab may run the scheduler and save the workspace. The first tab holds a Web
// Lock; others show "Use here", which steals the lock.
const NAME = 'kss-studio-primary'
let release = null
let listeners = new Set()
let state = null
let started = null

function set(primary) {
  state = primary
  listeners.forEach((fn) => fn(primary))
}

function hold(options) {
  return navigator.locks.request(NAME, options, (lock) => {
    if (!lock) {
      set(false)
      return undefined
    }
    set(true)
    return new Promise((resolve) => { release = resolve })
  }).catch((err) => {
    // Another tab stole the lock.
    if (err?.name === 'AbortError') set(false)
    else throw err
  }).finally(() => {
    if (state) set(false)
  })
}

export function acquirePrimary(onChange) {
  listeners.add(onChange)
  if (!navigator.locks) {
    // Very old browsers: assume this is the only tab.
    onChange(true)
    return () => listeners.delete(onChange)
  }
  if (state !== null) onChange(state)
  if (!started) started = hold({ ifAvailable: true })
  return () => listeners.delete(onChange)
}

export function takeOver() {
  if (!navigator.locks) return
  release?.()
  release = null
  started = hold({ steal: true })
}
