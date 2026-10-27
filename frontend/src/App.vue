<template>
  <div class="app-shell">
    <Navbar v-if="route.meta.requiresAuth" />
    <main id="main-content">
      <RouterView :key="route.path" />
    </main>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
import Navbar from './components/Navbar.vue'
const route = useRoute()
</script>
