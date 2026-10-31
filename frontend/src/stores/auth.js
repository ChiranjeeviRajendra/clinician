import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../services/auth.js'

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
  const isAuthenticated = computed(() => Boolean(user.value && sessionToken.value))

  function clearSession() {
    user.value = null
    sessionToken.value = null
    expiresAt.value = null
    removeSavedSession()
  }

  function hasSession() {
    const valid = isAuthenticated.value && Date.parse(expiresAt.value) > Date.now()
    if (!valid) clearSession()
    return valid
  }

  async function signIn(credentials) {
    const response = await authApi.login(credentials)
    try {
      const profile = await authApi.me(response.session_token)
      const expiry = Math.min(Date.parse(response.expires_at), Date.now() + SESSION_DURATION_MS)
      if (!Number.isFinite(expiry) || expiry <= Date.now()) {
        throw new Error('The session has expired. Please sign in again.')
      }
      user.value = profile.user
      sessionToken.value = response.session_token
      expiresAt.value = new Date(expiry).toISOString()
      try {
        globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({
          user: user.value, sessionToken: sessionToken.value, expiresAt: expiresAt.value,
        }))
      } catch {
        // The active session remains usable if the browser blocks storage.
      }
    } catch (error) {
      clearSession()
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

  return { user, sessionToken, expiresAt, isAuthenticated, hasSession, clearSession, signIn, signOut }
})
