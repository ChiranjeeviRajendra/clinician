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

        <form class="form-stack" @submit.prevent="submit">
          <div v-if="isRegister" class="field">
            <label for="name">Full name</label>
            <input id="name" v-model="name" name="name" autocomplete="name" placeholder="Your name" maxlength="100" required :disabled="pending" />
          </div>
          <div class="field">
            <label for="email">Email address</label>
            <input id="email" v-model="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" maxlength="254" required :disabled="pending" />
          </div>
          <div class="field">
            <div class="field-heading">
              <label for="password">Password</label>
              <RouterLink v-if="!isRegister" to="/forgot-password" class="small-link">Forgot password?</RouterLink>
            </div>
            <div class="password-input">
              <input id="password" v-model="password" name="password" :type="showPassword ? 'text' : 'password'" :autocomplete="isRegister ? 'new-password' : 'current-password'" :placeholder="isRegister ? 'At least 12 characters' : 'Enter your password'" :minlength="isRegister ? 12 : 1" maxlength="128" required :disabled="pending" :aria-describedby="isRegister ? 'password-hint' : undefined" />
              <button type="button" :aria-label="showPassword ? 'Hide password' : 'Show password'" :aria-pressed="showPassword" @click="showPassword = !showPassword">{{ showPassword ? 'Hide' : 'Show' }}</button>
            </div>
            <small v-if="isRegister" id="password-hint">Use 12–128 characters. You’ll verify your email before signing in.</small>
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
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { authApi } from '../services/auth.js'
import { useAuthStore } from '../stores/auth.js'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const isRegister = computed(() => route.query.mode === 'register')
const name = ref('')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const pending = ref(false)
const error = ref(route.query.expired ? 'Your session has expired. Please sign in again.' : '')
const success = ref('')

async function setMode(register) {
  error.value = ''
  success.value = ''
  password.value = ''
  showPassword.value = false
  await router.replace({ name: 'login', query: { ...(register ? { mode: 'register' } : {}), ...(route.query.redirect ? { redirect: route.query.redirect } : {}) } })
}

async function submit() {
  if (pending.value) return
  pending.value = true
  error.value = ''
  success.value = ''
  try {
    const credentials = { email: email.value.trim(), password: password.value }
    if (isRegister.value) {
      await authApi.register({ ...credentials, name: name.value.trim() })
      await setMode(false)
      success.value = `We sent a verification link to ${credentials.email}. Verify your email, then sign in here.`
    } else {
      await auth.signIn(credentials)
      // Only redirect to a known local destination.
      await router.replace({ name: 'home' })
    }
  } catch (failure) {
    error.value = failure.message
  } finally {
    password.value = ''
    pending.value = false
  }
}
</script>
