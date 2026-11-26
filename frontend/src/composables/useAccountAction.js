import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi } from '../services/auth.js'
import { useAccountValidation } from './useAccountValidation.js'

export function useAccountAction() {
  const route = useRoute()
  const router = useRouter()
  const isForgot = computed(() => route.name === 'forgot-password')
  const isReset = computed(() => route.name === 'reset-password')
  const token = ref(new URLSearchParams(route.hash.slice(1)).get('token') || '')
  const email = ref('')
  const password = ref('')
  const confirmPassword = ref('')
  const pending = ref(false)
  const success = ref('')
  const error = ref(
    !isForgot.value && !token.value
      ? 'This link is missing its token. Open the complete link from your email.'
      : '',
  )
  const heading = computed(() =>
    isForgot.value
      ? 'Let’s get you back in.'
      : isReset.value
        ? 'A fresh start.'
        : 'Make it official.',
  )
  const description = computed(() =>
    isForgot.value
      ? 'Enter your email and we’ll send a password-reset link.'
      : isReset.value
        ? 'Choose a new password for your Clinician account.'
        : 'Confirm your email to start the conversation.',
  )
  const buttonText = computed(() =>
    isForgot.value ? 'Send reset link' : isReset.value ? 'Set new password' : 'Verify my email',
  )
  const { form, fieldError, touch, validate, resetValidation } = useAccountValidation(
    () => ({
      email: email.value,
      password: password.value,
      confirmPassword: confirmPassword.value,
    }),
    () => (isForgot.value ? 'forgot' : isReset.value ? 'reset' : 'verify'),
  )

  onMounted(() => {
    if (route.hash) router.replace({ path: route.path, hash: '' })
  })

  async function submit() {
    if (pending.value) return
    error.value = ''
    if (!validate()) return
    pending.value = true
    try {
      const response = isForgot.value
        ? await authApi.forgotPassword(email.value.trim())
        : isReset.value
          ? await authApi.resetPassword(token.value, password.value)
          : await authApi.verifyEmail(token.value)
      success.value = response.message
      token.value = ''
    } catch (failure) {
      error.value = failure.message
    } finally {
      password.value = ''
      confirmPassword.value = ''
      resetValidation()
      pending.value = false
    }
  }

  return {
    isForgot,
    isReset,
    token,
    email,
    password,
    confirmPassword,
    pending,
    success,
    error,
    heading,
    description,
    buttonText,
    form,
    fieldError,
    touch,
    submit,
  }
}
