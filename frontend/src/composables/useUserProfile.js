import { onBeforeUnmount, onMounted, ref } from 'vue'
import { profileApi } from '../services/profile.js'
import { useAuthStore } from '../stores/auth.js'
import { useRequestError } from './useRequestError.js'

export function useUserProfile({ includeOptions = false } = {}) {
  const auth = useAuthStore()
  const profile = ref(null)
  const options = ref({ ethnicities: [] })
  const loading = ref(true)
  const saving = ref(false)
  const controller = new AbortController()
  const { error, handleError } = useRequestError(controller.signal)

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const token = auth.sessionToken
      const requestOptions = { signal: controller.signal }
      const [response, ethnicities] = await Promise.all([
        profileApi.getUserProfile(token, requestOptions),
        includeOptions ? profileApi.getEthnicities(token, requestOptions) : null,
      ])
      if (controller.signal.aborted) return
      if (includeOptions) options.value = { ethnicities: ethnicities.ethnicities }
      profile.value = response.profile
      auth.setProfileName(response.profile.full_name, token)
    } catch (failure) {
      await handleError(failure)
    } finally {
      loading.value = false
    }
  }

  async function save(changes) {
    if (saving.value) return false
    saving.value = true
    error.value = ''
    try {
      const token = auth.sessionToken
      const response = await profileApi.updateUserProfile(changes, token, {
        signal: controller.signal,
      })
      if (controller.signal.aborted) return false
      profile.value = response.profile
      auth.setProfileName(response.profile.full_name, token)
      return true
    } catch (failure) {
      await handleError(failure)
      return false
    } finally {
      saving.value = false
    }
  }

  onMounted(load)
  onBeforeUnmount(() => controller.abort())
  return { profile, options, loading, saving, error, load, save }
}
