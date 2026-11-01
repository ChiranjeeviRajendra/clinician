<template>
  <div class="app-shell">
    <Navbar v-if="auth.appStatus === 'ready' && auth.isAuthenticated && route.meta.requiresAuth" />
    <main v-if="auth.appStatus === 'ready' && (!route.meta.requiresAuth || auth.isAuthenticated)" id="main-content">
      <RouterView :key="route.path" />
    </main>
    <section v-else class="app-startup" aria-live="polite" :aria-busy="auth.appStatus === 'loading'">
      <template v-if="auth.appStatus === 'error'">
        <h1>Unable to load Clinician</h1>
        <p>{{ auth.appError }}</p>
        <button class="primary-button" @click="retry">Try again</button>
      </template>
      <p v-else>Loading Clinician...</p>
    </section>
  </div>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import Navbar from './components/Navbar.vue'
import { useAuthStore } from './stores/auth.js'
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

async function retry() {
  await router.replace(window.location.pathname + window.location.search + window.location.hash)
}
</script>

<style scoped>
.app-startup { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 32px; text-align: center; }
</style>
