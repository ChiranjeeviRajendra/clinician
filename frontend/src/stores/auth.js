import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { authApi } from '../services/auth.js'

export const useAuthStore = defineStore('auth', () => {
  // Keep Bearer credentials in memory instead of browser persistent storage.
  const user = ref(null)
  const sessionToken = ref(null)
  const expiresAt = ref(null)
  const isAuthenticated = computed(() => Boolean(user.value && sessionToken.value))

  function clearSession() {
    user.value = null
    sessionToken.value = null
    expiresAt.value = null
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
      user.value = profile.user
      sessionToken.value = response.session_token
      expiresAt.value = response.expires_at
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
