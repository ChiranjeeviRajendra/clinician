<template>
  <header class="navbar">
    <RouterLink v-slot="{ href }" to="/home" custom>
      <a :href="href" class="brand" aria-label="Clinician home" @click="selectPage($event, '/home')">
        <BrandMark />
        <span>clinician<span class="brand-period">.</span></span>
      </a>
    </RouterLink>
    <nav class="workspace-nav" aria-label="Primary navigation">
      <RouterLink v-for="item in navigation" :key="item.path" v-slot="{ href }" :to="item.path" custom>
        <a :href="href" :class="{ 'router-link-active': selectedPath === item.path }" :aria-current="selectedPath === item.path ? 'page' : undefined" @click="selectPage($event, item.path)">{{ item.label }}</a>
      </RouterLink>
    </nav>
    <div class="nav-account">
      <span class="account-email">{{ auth.user?.email }}</span>
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
import { navigateTo } from '../router/navigation.js'

const router = useRouter()
const auth = useAuthStore()
const pending = ref(false)
const error = ref('')
const initial = computed(() => (auth.user?.email || 'U')[0].toUpperCase())
const selectedPath = computed(() => router.resolve(auth.pendingRoute || router.currentRoute.value.fullPath).path)
const navigation = [
  { path: '/chat', label: 'Chat with AI' },
  { path: '/profile', label: 'Profile' },
  { path: '/faxes', label: 'Faxes' },
]

function selectPage(event, target) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigateTo(router, auth, target)
}

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
