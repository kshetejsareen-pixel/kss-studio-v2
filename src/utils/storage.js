// Loads settings from localStorage on app start
// Call this in App.jsx useEffect

export function loadSavedSettings() {
  try {
    const saved = localStorage.getItem('kss_settings')
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}
