import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../services/auth.js'
import { userApi } from '../services/user.js'

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

export const useAuthStore = defineStore('auth', () => {
  const restored = restoreSession()
  const saved = restored.session
  const user = ref(saved?.user ?? null)
  const sessionToken = ref(saved?.sessionToken ?? null)
  const expiresAt = ref(saved?.expiresAt ?? null)
  const userInfo = ref(null)
  const appStatus = ref('idle')
  const appError = ref('')
  const routeRequests = ref(0)
  const isRouteLoading = computed(() => routeRequests.value > 0)
  const loginReason = ref(restored.reason)
  const returnTo = ref(readStorage(RETURN_TO_STORAGE_KEY))
  const pendingRoute = ref(null)
  let initialization
  let sessionVersion = 0
  let userInfoToken = null
  const isAuthenticated = computed(() => Boolean(user.value && sessionToken.value))

  function clearSession() {
    sessionVersion += 1
    initialization?.controller.abort()
    user.value = null
    sessionToken.value = null
    expiresAt.value = null
    userInfo.value = null
    userInfoToken = null
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

  async function loadStartup(token, { signal } = {}) {
    routeRequests.value += 1
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      routeRequests.value -= 1
    }
    signal?.addEventListener('abort', finish, { once: true })
    try {
      const authentication = await authApi.authenticate(token, { signal })
      signal?.throwIfAborted()
      if (authentication.status !== 'valid') {
        const error = new Error(LOGIN_MESSAGES.denied)
        error.status = 401
        error.code = authentication.status === 'expired' ? 'session_expired' : 'unauthorized'
        throw error
      }
      // Reuse account information only for the session that loaded it.
      const info = userInfoToken === token ? null : await userApi.info(token, { signal })
      return { authentication, info }
    } finally {
      finish()
      signal?.removeEventListener('abort', finish)
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
    if (sessionToken.value !== token) {
      userInfo.value = null
      userInfoToken = null
    }
    user.value = profile
    sessionVersion += 1
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

  async function initializeApp({ force = false, signal, initialLogin = false } = {}) {
    if (signal?.aborted) return
    if (appStatus.value === 'ready' && !force) return
    if (initialLogin) {
      loginReason.value = ''
      appError.value = ''
    }
    const token = savedToken()
    if (!token) {
      initialization?.controller.abort()
      if (initialLogin) endSession('')
      else if (sessionToken.value) endSession('denied')
      appStatus.value = 'ready'
      return
    }
    if (initialization && !initialization.controller.signal.aborted && initialization.signal === signal &&
        initialization.initialLogin === initialLogin) {
      return initialization.promise
    }
    initialization?.controller.abort()
    if (!initialLogin && expiresAt.value && Date.parse(expiresAt.value) <= Date.now()) {
      endSession('expired')
      return
    }
    // Keep the current page mounted while a later navigation is validated.
    if (appStatus.value !== 'ready') appStatus.value = 'loading'
    appError.value = ''
    const validationVersion = sessionVersion
    const request = { controller: new AbortController(), signal, initialLogin, promise: null }
    initialization = request
    const abort = () => request.controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    request.promise = (async () => {
      try {
        const { authentication, info } = await loadStartup(token, { signal: request.controller.signal })
        if (request.controller.signal.aborted || initialization !== request || validationVersion !== sessionVersion) return
        const previousExpiry = Date.parse(expiresAt.value)
        const account = info ? { email: info.email, email_verified: info.email_verified } : user.value
        saveSession(account, token, authentication.expires_at, Math.min(
          Number.isFinite(previousExpiry) ? previousExpiry : Infinity,
          info ? Date.parse(info.expires_at) : Infinity,
        ))
        if (info) {
          userInfo.value = { email: info.email, email_verified: info.email_verified, expires_at: info.expires_at }
          userInfoToken = token
        }
        loginReason.value = ''
        appStatus.value = 'ready'
      } catch (error) {
        if (request.controller.signal.aborted || initialization !== request || validationVersion !== sessionVersion) return
        if (error.code === 'request_cancelled') return
        if (error.status === 401) {
          endSession(initialLogin ? '' : error.code === 'session_expired' ? 'expired' : 'denied')
        } else {
          appError.value = error.message
          appStatus.value = 'error'
        }
      }
    })()
    try {
      await request.promise
    } finally {
      signal?.removeEventListener('abort', abort)
      if (initialization === request) initialization = null
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
      saveSession(response.user, response.session_token, response.expires_at)
      // The destination's guard authenticates first, then loads userInfo if needed.
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
    // No server-side session exists to revoke; logout also works offline.
    clearSession()
    loginReason.value = ''
  }

  return {
    user, sessionToken, expiresAt, userInfo, appStatus, appError, isRouteLoading, loginReason, returnTo, pendingRoute,
    isAuthenticated, hasSession, clearSession, signIn, signOut,
    initializeApp, endSession, rememberPage,
  }
})
