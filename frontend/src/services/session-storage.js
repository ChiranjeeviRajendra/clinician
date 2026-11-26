export const SESSION_STORAGE_KEY = 'clinician.auth.session'
export const RETURN_TO_STORAGE_KEY = 'clinician.auth.returnTo'

export function readStorage(key) {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeStorage(key, value) {
  try {
    globalThis.sessionStorage?.setItem(key, value)
    return readStorage(key) === value
  } catch {
    // Callers retain their in-memory state when tab storage is unavailable.
    return false
  }
}

export function savedToken() {
  try {
    const token = JSON.parse(readStorage(SESSION_STORAGE_KEY))?.sessionToken
    return typeof token === 'string' && token.trim() ? token : null
  } catch {
    return null
  }
}

export function removeSavedSession() {
  try {
    globalThis.sessionStorage?.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function restoreSession() {
  const raw = readStorage(SESSION_STORAGE_KEY)
  if (!raw) return { session: null, reason: '' }
  try {
    const saved = JSON.parse(raw)
    if (saved && typeof saved.sessionToken === 'string' && saved.sessionToken.trim()) {
      const expiry = Date.parse(saved.expiresAt)
      // Initialization enforces expiry once the initial route is known, so a
      // direct login-page load can check an existing token with the server.
      if (saved.expiresAt == null || Number.isFinite(expiry)) {
        return { session: saved, reason: '' }
      }
    }
  } catch {
    // Discard malformed data and keep login available when storage is blocked.
  }
  removeSavedSession()
  return { session: null, reason: 'denied' }
}
