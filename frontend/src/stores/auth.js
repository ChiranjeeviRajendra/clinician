import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../services/auth.js'
import { appApi } from '../services/app.js'

export const SESSION_STORAGE_KEY = 'clinician.auth.session'
export const RETURN_TO_STORAGE_KEY = 'clinician.auth.returnTo'
export const LOGIN_MESSAGES = {
  denied: 'You do not have access to the app. Please login to continue.',
  expired: 'Your login session expired. Please login to continue.',
}
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000

function readStorage(key) {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function savedToken() {
  try {
    const token = JSON.parse(readStorage(SESSION_STORAGE_KEY))?.sessionToken
    return typeof token === 'string' && token.trim() ? token : null
  } catch {
    return null
  }
}

function removeSavedSession() {
  try {
    globalThis.sessionStorage?.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function restoreSession() {
  const raw = readStorage(SESSION_STORAGE_KEY)
  if (!raw) return { session: null, reason: '' }
  try {
    const saved = JSON.parse(raw)
    if (saved && typeof saved.sessionToken === 'string' && saved.sessionToken.trim()) {
      const expiry = Date.parse(saved.expiresAt)
      if (Number.isFinite(expiry) && expiry <= Date.now()) {
        removeSavedSession()
        return { session: null, reason: 'expired' }
      }
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

export const useAuthStore = defineStore('auth', () => {
  const restored = restoreSession()
  const saved = restored.session
  const user = ref(saved?.user ?? null)
  const sessionToken = ref(saved?.sessionToken ?? null)
  const expiresAt = ref(saved?.expiresAt ?? null)
  const appInfo = ref(null)
  const appStatus = ref('idle')
  const appError = ref('')
  const loginReason = ref(restored.reason)
  const returnTo = ref(readStorage(RETURN_TO_STORAGE_KEY))
  let initialization
  const isAuthenticated = computed(() => Boolean(user.value && sessionToken.value))

  function clearSession() {
    user.value = null
    sessionToken.value = null
    expiresAt.value = null
    appInfo.value = null
    removeSavedSession()
  }

  function endSession(reason = 'denied') {
    clearSession()
    loginReason.value = reason
    appStatus.value = 'ready'
  }

  function rememberPage(path) {
    returnTo.value = path
    try {
      globalThis.sessionStorage?.setItem(RETURN_TO_STORAGE_KEY, path)
    } catch {
      // Keep the destination in memory if tab storage is unavailable.
    }
  }

  function saveSession(profile, token, serverExpiry, maximumExpiry = Infinity) {
    const expiry = Math.min(Date.parse(serverExpiry), maximumExpiry, Date.now() + SESSION_DURATION_MS)
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      const error = new Error('The session has expired. Please sign in again.')
      error.status = 401
      error.code = 'session_expired'
      throw error
    }
    user.value = profile
    sessionToken.value = token
    expiresAt.value = new Date(expiry).toISOString()
    try {
      globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        user: user.value, sessionToken: sessionToken.value, expiresAt: expiresAt.value,
      }))
      return savedToken() === token
    } catch {
      // The active session remains usable if the browser blocks storage.
      return false
    }
  }

  async function initializeApp() {
    if (initialization) return initialization
    if (appStatus.value === 'ready') return
    const token = savedToken()
    if (!token) {
      if (sessionToken.value) endSession('denied')
      appStatus.value = 'ready'
      return
    }
    if (expiresAt.value && Date.parse(expiresAt.value) <= Date.now()) {
      endSession('expired')
      return
    }
    appStatus.value = 'loading'
    appError.value = ''
    initialization = (async () => {
      try {
        const info = await appApi.info(token)
        const previousExpiry = Date.parse(expiresAt.value)
        saveSession(info.user, token, info.expires_at, Number.isFinite(previousExpiry) ? previousExpiry : Infinity)
        appInfo.value = info
        loginReason.value = ''
        appStatus.value = 'ready'
      } catch (error) {
        if (error.status === 401) {
          endSession(error.code === 'session_expired' ? 'expired' : 'denied')
        } else {
          appError.value = error.message
          appStatus.value = 'error'
        }
      }
    })()
    try {
      await initialization
    } finally {
      initialization = null
    }
  }

  function hasSession() {
    if (!isAuthenticated.value) return false
    if (Date.parse(expiresAt.value) <= Date.now()) {
      endSession('expired')
      return false
    }
    return Number.isFinite(Date.parse(expiresAt.value))
  }

  async function signIn(credentials) {
    const response = await authApi.login(credentials)
    try {
      const persisted = saveSession(response.user, response.session_token, response.expires_at)
      if (persisted) {
        const info = await appApi.info(response.session_token)
        saveSession(info.user, response.session_token, info.expires_at, Date.parse(expiresAt.value))
        appInfo.value = info
      }
      loginReason.value = ''
      appStatus.value = 'ready'
    } catch (error) {
      clearSession()
      if (error.status === 401) {
        endSession(error.code === 'session_expired' ? 'expired' : 'denied')
        error.message = LOGIN_MESSAGES[loginReason.value]
      }
      throw error
    }
  }

  async function signOut() {
    if (sessionToken.value) {
      try {
        await authApi.logout(sessionToken.value)
      } catch (error) {
        if (error.status !== 401) throw error
      }
    }
    clearSession()
    loginReason.value = ''
  }

  return {
    user, sessionToken, expiresAt, appInfo, appStatus, appError, loginReason, returnTo,
    isAuthenticated, hasSession, clearSession, signIn, signOut,
    initializeApp, endSession, rememberPage,
  }
})
