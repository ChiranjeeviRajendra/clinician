import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loginLocation } from '../router/session.js'
import { useAuthStore } from '../stores/auth.js'

// Protected pages share cancellation, session expiry, and retryable error behavior.
export function useRequestError(signal) {
  const auth = useAuthStore()
  const route = useRoute()
  const router = useRouter()
  const error = ref('')

  async function handleError(failure) {
    if (signal?.aborted || failure.code === 'request_cancelled') return
    if (failure.status === 401) {
      const reason = failure.code === 'session_expired' ? 'expired' : 'denied'
      await router.replace(loginLocation(auth, route.fullPath, reason))
      return
    }
    error.value = failure.message
  }

  return { error, handleError }
}
