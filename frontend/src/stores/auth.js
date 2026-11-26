import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError } from '../services/http.js'
import { authApi } from '../services/auth.js'
import { userApi } from '../services/user.js'
import { profileApi } from '../services/profile.js'
import {
  SESSION_STORAGE_KEY,
  RETURN_TO_STORAGE_KEY,
  readStorage,
  writeStorage,
  savedToken,
  removeSavedSession,
  restoreSession,
} from '../services/session-storage.js'

export const LOGIN_MESSAGES = {
  denied: 'You do not have access to the app. Please login to continue.',
  expired: 'Your login session expired. Please login to continue.',
}
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000

export const useAuthStore = defineStore('auth', () => {
  const restored = restoreSession()
  const saved = restored.session
  const user = ref(saved?.user ?? null)
  const fullName = ref(typeof saved?.fullName === 'string' ? saved.fullName.trim() || null : null)
  const displayName = computed(() => fullName.value || user.value?.email || '')
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
    fullName.value = null
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
    writeStorage(RETURN_TO_STORAGE_KEY, path)
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
        throw new ApiError(
          LOGIN_MESSAGES.denied,
          401,
          authentication.status === 'expired' ? 'session_expired' : 'unauthorized',
        )
      }
      // Reuse account information only for the session that loaded it.
      const [info, profileResponse] =
        userInfoToken === token
          ? [null, null]
          : await Promise.all([
              userApi.info(token, { signal }),
              profileApi.getUserProfile(token, { signal, routeScoped: false }).catch((error) => {
                // Profile availability does not block access to the rest of the app.
                if (error.status === 401 || error.code === 'request_cancelled' || signal?.aborted)
                  throw error
                return null
              }),
            ])
      return { authentication, info, profile: profileResponse?.profile }
    } finally {
      finish()
      signal?.removeEventListener('abort', finish)
    }
  }

  function saveSession(account, token, serverExpiry, maximumExpiry = Infinity) {
    const expiry = Math.min(
      Date.parse(serverExpiry),
      maximumExpiry,
      Date.now() + SESSION_DURATION_MS,
    )
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      throw new ApiError('The session has expired. Please sign in again.', 401, 'session_expired')
    }
    if (sessionToken.value !== token) {
      userInfo.value = null
      userInfoToken = null
      fullName.value = null
    }
    user.value = account
    sessionVersion += 1
    sessionToken.value = token
    expiresAt.value = new Date(expiry).toISOString()
    return persistSession()
  }

  function persistSession() {
    return writeStorage(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        user: user.value,
        fullName: fullName.value,
        sessionToken: sessionToken.value,
        expiresAt: expiresAt.value,
      }),
    )
  }

  function setProfileName(name, token) {
    if (!token || token !== sessionToken.value) return
    fullName.value = typeof name === 'string' ? name.trim() || null : null
    persistSession()
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
    if (
      initialization &&
      !initialization.controller.signal.aborted &&
      initialization.signal === signal &&
      initialization.initialLogin === initialLogin
    ) {
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
        const { authentication, info, profile } = await loadStartup(token, {
          signal: request.controller.signal,
        })
        if (
          request.controller.signal.aborted ||
          initialization !== request ||
          validationVersion !== sessionVersion
        )
          return
        const previousExpiry = Date.parse(expiresAt.value)
        const account = info
          ? { email: info.email, email_verified: info.email_verified }
          : user.value
        saveSession(
          account,
          token,
          authentication.expires_at,
          Math.min(
            Number.isFinite(previousExpiry) ? previousExpiry : Infinity,
            info ? Date.parse(info.expires_at) : Infinity,
          ),
        )
        if (info) {
          userInfo.value = {
            email: info.email,
            email_verified: info.email_verified,
            expires_at: info.expires_at,
          }
          userInfoToken = token
        }
        if (profile) setProfileName(profile.full_name, token)
        loginReason.value = ''
        appStatus.value = 'ready'
      } catch (error) {
        if (
          request.controller.signal.aborted ||
          initialization !== request ||
          validationVersion !== sessionVersion
        )
          return
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
    user,
    fullName,
    displayName,
    sessionToken,
    expiresAt,
    userInfo,
    appStatus,
    appError,
    isRouteLoading,
    loginReason,
    returnTo,
    pendingRoute,
    isAuthenticated,
    hasSession,
    clearSession,
    signIn,
    signOut,
    initializeApp,
    endSession,
    rememberPage,
    setProfileName,
  }
})
