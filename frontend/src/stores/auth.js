import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../services/auth.js'
import { appApi } from '../services/app.js'

export const SESSION_STORAGE_KEY = 'clinician.auth.session'
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000

function removeSavedSession() {
  try {
    globalThis.sessionStorage?.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function restoreSession() {
  try {
    const saved = JSON.parse(globalThis.sessionStorage?.getItem(SESSION_STORAGE_KEY) || 'null')
    if (saved && typeof saved.user?.id === 'string' && typeof saved.user?.email === 'string'
      && typeof saved.sessionToken === 'string' && saved.sessionToken.length > 0
      && typeof saved.expiresAt === 'string' && Date.parse(saved.expiresAt) > Date.now()) {
      return saved
    }
  } catch {
    // Discard malformed data and keep login available when storage is blocked.
  }
  removeSavedSession()
  return null
}

export const useAuthStore = defineStore('auth', () => {
  const saved = restoreSession()
  const user = ref(saved?.user ?? null)
  const sessionToken = ref(saved?.sessionToken ?? null)
  const expiresAt = ref(saved?.expiresAt ?? null)
  const appInfo = ref(null)
  const appStatus = ref('idle')
  const appError = ref('')
  let initialization
  const isAuthenticated = computed(() => Boolean(user.value && sessionToken.value))

  function clearSession() {
    user.value = null
    sessionToken.value = null
    expiresAt.value = null
    appInfo.value = null
    removeSavedSession()
  }

  function denyAccess() {
    clearSession()
    appStatus.value = 'denied'
  }

  function dismissAccessDenied() {
    appStatus.value = 'ready'
  }

  function saveSession(profile, token, serverExpiry, maximumExpiry = Infinity) {
    const expiry = Math.min(Date.parse(serverExpiry), maximumExpiry, Date.now() + SESSION_DURATION_MS)
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      const error = new Error('The session has expired. Please sign in again.')
      error.status = 401
      throw error
    }
    user.value = profile
    sessionToken.value = token
    expiresAt.value = new Date(expiry).toISOString()
    try {
      globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        user: user.value, sessionToken: sessionToken.value, expiresAt: expiresAt.value,
      }))
    } catch {
      // The active session remains usable if the browser blocks storage.
    }
  }

  async function initializeApp({ allowAnonymous = false } = {}) {
    if (initialization) return initialization
    if (appStatus.value === 'ready' || appStatus.value === 'denied') return
    appStatus.value = 'loading'
    appError.value = ''
    initialization = (async () => {
      try {
        const info = await appApi.info(sessionToken.value)
        saveSession(info.user, sessionToken.value, info.expires_at, Date.parse(expiresAt.value))
        appInfo.value = info
        appStatus.value = 'ready'
      } catch (error) {
        if (error.status === 401) {
          denyAccess()
          if (allowAnonymous) dismissAccessDenied()
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
    const valid = isAuthenticated.value && Date.parse(expiresAt.value) > Date.now()
    if (!valid) clearSession()
    return valid
  }

  async function signIn(credentials) {
    const response = await authApi.login(credentials)
    try {
      const info = await appApi.info(response.session_token)
      saveSession(info.user, response.session_token, info.expires_at)
      appInfo.value = info
      appStatus.value = 'ready'
    } catch (error) {
      clearSession()
      if (error.status === 401) denyAccess()
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
  }

  return {
    user, sessionToken, expiresAt, appInfo, appStatus, appError,
    isAuthenticated, hasSession, clearSession, signIn, signOut,
    initializeApp, denyAccess, dismissAccessDenied,
  }
})
