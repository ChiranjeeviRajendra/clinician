import { reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserProfile } from './useUserProfile.js'
import { useNotificationsStore } from '../stores/notifications.js'
import { profileChanges, profileForm } from '../utils/profile.js'

export function useProfileEditor() {
  const state = useUserProfile({ includeOptions: true })
  const router = useRouter()
  const notifications = useNotificationsStore()
  const form = reactive({})
  const pending = ref(false)
  const today = new Date().toISOString().slice(0, 10)

  watch(state.profile, (profile) => {
    if (profile) Object.assign(form, profileForm(profile))
  })

  async function submit() {
    if (pending.value || !state.profile.value) return
    pending.value = true
    try {
      if (!await state.save(profileChanges(form, state.profile.value))) {
        if (state.error.value) notifications.error(state.error.value)
        return
      }
      const message = state.profile.value.isProfileCompleted
        ? 'Profile saved. Your profile is complete.'
        : 'Profile saved. You can add more details anytime.'
      await router.push({ name: 'profile' })
      notifications.success(message)
    } catch (failure) {
      notifications.error(failure.message || 'Unable to open your profile. Please try again.')
    } finally {
      pending.value = false
    }
  }

  return { ...state, form, today, pending, submit }
}
