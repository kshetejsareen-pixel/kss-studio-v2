// Workspace management — each client/project is a separate workspace
// Workspaces stored in localStorage, switched without losing data

const WS_KEY = 'kss_workspaces'
const ACTIVE_KEY = 'kss_active_workspace'

export function loadWorkspaces() {
  try {
    return JSON.parse(localStorage.getItem(WS_KEY) || '{}')
  } catch { return {} }
}

export function saveWorkspace(id, data) {
  const all = loadWorkspaces()
  all[id] = { ...data, savedAt: new Date().toISOString() }
  localStorage.setItem(WS_KEY, JSON.stringify(all))
}

export function deleteWorkspace(id) {
  const all = loadWorkspaces()
  delete all[id]
  localStorage.setItem(WS_KEY, JSON.stringify(all))
}

export function getActiveWorkspaceId() {
  return localStorage.getItem(ACTIVE_KEY) || 'default'
}

export function setActiveWorkspaceId(id) {
  localStorage.setItem(ACTIVE_KEY, id)
}

export function generateWorkspaceId() {
  return 'ws_' + Date.now()
}
