<template>
  <div class="account-action-layout">
    <RouterLink to="/login" class="brand"><BrandMark /><span>clinician<span class="brand-period">.</span></span></RouterLink>
    <section class="account-action-card" aria-labelledby="action-heading">
      <span class="action-symbol" aria-hidden="true">{{ success ? '✓' : '↗' }}</span>
      <span class="eyebrow muted">A QUICK ACCOUNT CHECK</span>
      <h1 id="action-heading">{{ heading }}</h1>
      <p class="form-intro">{{ description }}</p>
      <p v-if="success" class="notice success" role="status">{{ success }}</p>
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <form v-if="!success && (isForgot || token)" ref="form" class="form-stack" novalidate @submit.prevent="submit">
        <div v-if="isForgot" class="field">
          <label for="recovery-email">Email address</label>
          <input id="recovery-email" v-model.trim="email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required :disabled="pending" :aria-invalid="Boolean(fieldError('email'))" :aria-describedby="fieldError('email') ? 'recovery-email-error' : undefined" @blur="touch('email')" />
          <small v-if="fieldError('email')" id="recovery-email-error" class="field-error" role="alert">{{ fieldError('email') }}</small>
        </div>
        <div v-if="isReset" class="field">
          <label for="new-password">New password</label>
          <input id="new-password" v-model="password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" placeholder="At least 12 characters" required :disabled="pending" :aria-invalid="Boolean(fieldError('password'))" :aria-describedby="fieldError('password') ? 'new-password-error' : undefined" @blur="touch('password')" />
          <small v-if="fieldError('password')" id="new-password-error" class="field-error" role="alert">{{ fieldError('password') }}</small>
        </div>
        <div v-if="isReset" class="field">
          <label for="reset-confirm-password">Confirm new password</label>
          <input id="reset-confirm-password" v-model="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" maxlength="128" placeholder="Re-enter your new password" required :disabled="pending" :aria-invalid="Boolean(fieldError('confirmPassword'))" :aria-describedby="fieldError('confirmPassword') ? 'reset-confirm-password-error' : undefined" @blur="touch('confirmPassword')" />
          <small v-if="fieldError('confirmPassword')" id="reset-confirm-password-error" class="field-error" role="alert">{{ fieldError('confirmPassword') }}</small>
        </div>
        <button class="primary-button" type="submit" :disabled="pending"><span>{{ pending ? 'Just a moment…' : buttonText }}</span><span aria-hidden="true">→</span></button>
      </form>
      <RouterLink to="/login" class="back-link">← Back to sign in</RouterLink>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { authApi } from '../services/auth.js'
import { useAccountValidation } from '../composables/useAccountValidation.js'

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
const error = ref(!isForgot.value && !token.value ? 'This link is missing its token. Open the complete link from your email.' : '')
const heading = computed(() => isForgot.value ? 'Let’s get you back in.' : isReset.value ? 'A fresh start.' : 'Make it official.')
const description = computed(() => isForgot.value ? 'Enter your email and we’ll send a password-reset link.' : isReset.value ? 'Choose a new password for your Clinician account.' : 'Confirm your email to start the conversation.')
const buttonText = computed(() => isForgot.value ? 'Send reset link' : isReset.value ? 'Set new password' : 'Verify my email')
const { form, fieldError, touch, validate, resetValidation } = useAccountValidation(
  () => ({ email: email.value, password: password.value, confirmPassword: confirmPassword.value }),
  () => isForgot.value ? 'forgot' : isReset.value ? 'reset' : 'verify',
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
</script>
