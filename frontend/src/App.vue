<template>
  <div class="app-shell">
    <div :inert="auth.isAppInfoLoading" :aria-busy="auth.isAppInfoLoading">
      <Navbar v-if="auth.appStatus === 'ready' && auth.isAuthenticated && route.meta.requiresAuth" />
      <main v-if="auth.appStatus === 'ready' && (!route.meta.requiresAuth || auth.isAuthenticated)" id="main-content">
        <RouterView :key="route.path" />
      </main>
      <section v-else class="app-startup" aria-live="polite">
        <template v-if="auth.appStatus === 'error'">
          <h1>Unable to load Clinician</h1>
          <p>{{ auth.appError }}</p>
          <button class="primary-button" @click="retry">Try again</button>
        </template>
        <p v-else-if="!auth.isAppInfoLoading">Loading Clinician...</p>
      </section>
    </div>
    <div v-if="auth.isAppInfoLoading" class="route-loader" role="status" aria-live="polite">
      <span class="route-loader-spinner" aria-hidden="true"></span>
      <p>Loading Clinician...</p>
    </div>
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
  const { path, query, hash } = router.resolve(window.location.pathname + window.location.search + window.location.hash)
  await router.replace({ path, query, hash, force: true })
}
</script>

<style scoped>
.app-startup { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 32px; text-align: center; }
.route-loader { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px; background: #fafbf8e8; color: var(--ink); text-align: center; cursor: progress; }
.route-loader-spinner { width: 42px; height: 42px; border: 3px solid var(--border); border-top-color: var(--green); border-radius: 50%; animation: route-loader-spin .75s linear infinite; }
@keyframes route-loader-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .route-loader-spinner { animation: none; } }
</style>
