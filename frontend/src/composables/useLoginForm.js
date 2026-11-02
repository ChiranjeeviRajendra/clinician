import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi } from '../services/auth.js'
import { LOGIN_MESSAGES, useAuthStore } from '../stores/auth.js'
import { useNotificationsStore } from '../stores/notifications.js'
import { getReturnTo } from '../router/session.js'
import { useAccountValidation } from './useAccountValidation.js'

export function useLoginForm() {
  const route = useRoute()
  const router = useRouter()
  const auth = useAuthStore()
  const notifications = useNotificationsStore()
  const isRegister = computed(() => route.query.mode === 'register')
  const email = ref('')
  const password = ref('')
  const confirmPassword = ref('')
  const showPassword = ref(false)
  const showConfirmPassword = ref(false)
  const pending = ref(false)
  const success = ref('')
  const { form, fieldError, validate, resetValidation } = useAccountValidation(
    () => ({ email: email.value, password: password.value, confirmPassword: confirmPassword.value }),
    () => isRegister.value ? 'register' : 'login',
  )

  const sessionMessage = computed(() => {
    if (isRegister.value) return ''
    const reason = auth.loginReason || (['expired', 'denied'].includes(route.query.reason) ? route.query.reason : '')
    return LOGIN_MESSAGES[reason] || (route.query.expired ? LOGIN_MESSAGES.expired : '')
  })

  watch(sessionMessage, (message) => {
    if (message && notifications.notification?.message !== message) notifications.error(message)
  }, { immediate: true })

  function resetPasswordFields() {
    password.value = ''
    confirmPassword.value = ''
    showPassword.value = false
    showConfirmPassword.value = false
    resetValidation()
  }

  watch(isRegister, resetPasswordFields)

  async function setMode(register) {
    notifications.dismiss()
    success.value = ''
    resetPasswordFields()
    await router.replace({ name: 'login', query: { ...(register ? { mode: 'register' } : {}), ...(route.query.redirect ? { redirect: route.query.redirect } : {}) } })
  }

  async function submit() {
    if (pending.value) return
    notifications.dismiss()
    success.value = ''
    if (!validate(notifications.error)) return
    pending.value = true
    try {
      const credentials = { email: email.value.trim(), password: password.value }
      if (isRegister.value) {
        await authApi.register(credentials)
        await setMode(false)
        success.value = `We sent a verification link to ${credentials.email}. Verify your email, then sign in here.`
      } else {
        await auth.signIn(credentials)
        await router.replace(getReturnTo(router, route.query.redirect, auth.returnTo))
      }
    } catch (failure) {
      notifications.error(failure.message)
    } finally {
      resetPasswordFields()
      pending.value = false
    }
  }

  return {
    isRegister, email, password, confirmPassword, showPassword, showConfirmPassword,
    pending, success, form, fieldError, setMode, submit,
  }
}
