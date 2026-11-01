<template>
  <div class="auth-layout">
    <aside class="auth-story">
      <RouterLink to="/login" class="brand">
        <BrandMark /><span>clinician<span class="brand-period">.</span></span>
      </RouterLink>
      <div class="story-content">
        <span class="eyebrow"><span class="status-dot"></span> A LITTLE MORE CLARITY</span>
        <h1>Good questions.<br />Clearer<br /><span>understanding.</span></h1>
        <p>A thoughtful space to explore medical knowledge, one conversation at a time.</p>
        <div class="reference-card" aria-hidden="true">
          <span class="reference-icon">✳</span>
          <div><strong>Knowledge, with context.</strong><p>Answers grounded in your reference library.</p></div>
          <span class="reference-arrow">↗</span>
        </div>
      </div>
      <div class="story-footer"><span>BUILT FOR CURIOUS MINDS</span><span>01 / CLINICIAN</span></div>
      <div class="story-orbit" aria-hidden="true"></div>
    </aside>

    <section class="auth-form-panel" aria-labelledby="auth-heading">
      <div class="auth-form-wrap">
        <span class="eyebrow muted">YOUR NEXT QUESTION STARTS HERE</span>
        <h2 id="auth-heading">{{ isRegister ? 'Make room for curiosity.' : 'Welcome back.' }}</h2>
        <p class="form-intro">{{ isRegister ? 'Create your account and start exploring.' : 'Sign in to pick up the conversation.' }}</p>
        <div class="auth-tabs" aria-label="Account access">
          <button :class="{ active: !isRegister }" :aria-pressed="!isRegister" :disabled="pending" @click="setMode(false)">Sign in</button>
          <button :class="{ active: isRegister }" :aria-pressed="isRegister" :disabled="pending" @click="setMode(true)">Create account</button>
        </div>

        <div v-if="success" class="notice success" role="status">
          <strong>Check your inbox.</strong><p>{{ success }}</p>
        </div>
        <p v-if="error" class="notice error" role="alert">{{ error }}</p>
        <p v-else-if="!isRegister && sessionMessage" class="notice error" role="alert">{{ sessionMessage }}</p>

        <form ref="form" class="form-stack" novalidate @submit.prevent="submit">
          <div class="field">
            <label for="email">Email address</label>
            <input id="email" v-model.trim="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" maxlength="254" required :disabled="pending" :aria-invalid="Boolean(fieldError('email'))" :aria-describedby="fieldError('email') ? 'email-error' : undefined" @blur="touch('email')" />
            <small v-if="fieldError('email')" id="email-error" class="field-error" role="alert">{{ fieldError('email') }}</small>
          </div>
          <div class="field">
            <div class="field-heading">
              <label for="password">Password</label>
              <RouterLink v-if="!isRegister" to="/forgot-password" class="small-link">Forgot password?</RouterLink>
            </div>
            <div class="password-input">
              <input id="password" v-model="password" name="password" :type="showPassword ? 'text' : 'password'" :autocomplete="isRegister ? 'new-password' : 'current-password'" :placeholder="isRegister ? 'At least 12 characters' : 'Enter your password'" :minlength="isRegister ? 12 : 1" maxlength="128" required :disabled="pending" :aria-invalid="Boolean(fieldError('password'))" :aria-describedby="[isRegister ? 'password-hint' : '', fieldError('password') ? 'password-error' : ''].filter(Boolean).join(' ') || undefined" @blur="touch('password')" />
              <button type="button" :aria-label="showPassword ? 'Hide password' : 'Show password'" :aria-pressed="showPassword" :disabled="pending" @click="showPassword = !showPassword">{{ showPassword ? 'Hide' : 'Show' }}</button>
            </div>
            <small v-if="isRegister" id="password-hint">Use 12–128 characters. You’ll verify your email before signing in.</small>
            <small v-if="fieldError('password')" id="password-error" class="field-error" role="alert">{{ fieldError('password') }}</small>
          </div>
          <div v-if="isRegister" class="field">
            <label for="confirm-password">Confirm password</label>
            <div class="password-input">
              <input id="confirm-password" v-model="confirmPassword" name="confirmPassword" :type="showConfirmPassword ? 'text' : 'password'" autocomplete="new-password" placeholder="Re-enter your password" maxlength="128" required :disabled="pending" :aria-invalid="Boolean(fieldError('confirmPassword'))" :aria-describedby="fieldError('confirmPassword') ? 'confirm-password-error' : undefined" @blur="touch('confirmPassword')" />
              <button type="button" :aria-label="showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'" :aria-pressed="showConfirmPassword" :disabled="pending" @click="showConfirmPassword = !showConfirmPassword">{{ showConfirmPassword ? 'Hide' : 'Show' }}</button>
            </div>
            <small v-if="fieldError('confirmPassword')" id="confirm-password-error" class="field-error" role="alert">{{ fieldError('confirmPassword') }}</small>
          </div>
          <button class="primary-button" type="submit" :disabled="pending">
            <span>{{ pending ? (isRegister ? 'Creating account…' : 'Signing in…') : (isRegister ? 'Create your account' : 'Sign in') }}</span>
            <span v-if="!pending" aria-hidden="true">→</span><span v-else class="spinner" aria-hidden="true"></span>
          </button>
        </form>
        <p class="auth-switch">{{ isRegister ? 'Already have an account?' : 'New to Clinician?' }} <button class="inline-button" :disabled="pending" @click="setMode(!isRegister)">{{ isRegister ? 'Sign in' : 'Create an account' }} <span aria-hidden="true">↗</span></button></p>
        <div class="form-footnote"><span class="tiny-cross" aria-hidden="true">+</span> A focused space for informed questions.</div>
      </div>
      <span class="auth-copyright">CLINICIAN · MEDICAL KNOWLEDGE, MADE CLEARER</span>
    </section>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { authApi } from '../services/auth.js'
import { LOGIN_MESSAGES, useAuthStore } from '../stores/auth.js'
import { getReturnTo } from '../router/session.js'
import { useAccountValidation } from '../composables/useAccountValidation.js'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const isRegister = computed(() => route.query.mode === 'register')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const pending = ref(false)
const error = ref('')
const sessionMessage = computed(() => {
  const reason = auth.loginReason || (['expired', 'denied'].includes(route.query.reason) ? route.query.reason : '')
  return LOGIN_MESSAGES[reason] || (route.query.expired ? LOGIN_MESSAGES.expired : '')
})
const success = ref('')
const { form, fieldError, touch, validate, resetValidation } = useAccountValidation(
  () => ({ email: email.value, password: password.value, confirmPassword: confirmPassword.value }),
  () => isRegister.value ? 'register' : 'login',
)

function resetPasswordFields() {
  password.value = ''
  confirmPassword.value = ''
  showPassword.value = false
  showConfirmPassword.value = false
  resetValidation()
}

watch(isRegister, resetPasswordFields)

async function setMode(register) {
  error.value = ''
  success.value = ''
  resetPasswordFields()
  await router.replace({ name: 'login', query: { ...(register ? { mode: 'register' } : {}), ...(route.query.redirect ? { redirect: route.query.redirect } : {}) } })
}

async function submit() {
  if (pending.value) return
  error.value = ''
  success.value = ''
  if (!validate()) return
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
    error.value = failure.message
  } finally {
    resetPasswordFields()
    pending.value = false
  }
}
</script>
