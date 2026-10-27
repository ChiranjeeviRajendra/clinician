<template>
  <header class="navbar">
    <RouterLink to="/chat" class="brand" aria-label="Clinician home">
      <BrandMark />
      <span>clinician<span class="brand-period">.</span></span>
    </RouterLink>
    <span class="nav-context">Your knowledge companion</span>
    <div class="nav-account">
      <span class="account-name">{{ auth.user?.name || auth.user?.email }}</span>
      <span class="account-avatar" aria-hidden="true">{{ initial }}</span>
      <button class="text-button" :disabled="pending" @click="signOut">
        {{ pending ? 'Signing out…' : 'Sign out' }}
      </button>
    </div>
    <p v-if="error" class="nav-error" role="alert">{{ error }}</p>
  </header>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import BrandMark from './BrandMark.vue'
import { useAuthStore } from '../stores/auth.js'

const router = useRouter()
const auth = useAuthStore()
const pending = ref(false)
const error = ref('')
const initial = computed(() => (auth.user?.name || auth.user?.email || 'U')[0].toUpperCase())

async function signOut() {
  pending.value = true
  error.value = ''
  try {
    await auth.signOut()
    await router.replace({ name: 'login' })
  } catch (failure) {
    error.value = failure.message
  } finally {
    pending.value = false
  }
}
</script>
