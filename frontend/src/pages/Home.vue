<template>
  <section class="home-page" aria-labelledby="home-heading">
    <div class="home-intro">
      <span class="eyebrow muted">YOUR WORKSPACE</span>
      <h1 id="home-heading">Welcome back<span v-if="firstName">, {{ firstName }}</span>.</h1>
      <p>Where would you like to start?</p>
    </div>
    <div class="home-grid">
      <RouterLink v-for="destination in destinations" :key="destination.name" :to="{ name: destination.name }" class="home-card">
        <span class="home-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path v-for="path in destination.paths" :key="path" :d="path" />
          </svg>
        </span>
        <h2>{{ destination.label }}</h2>
        <span class="home-card-action">Open {{ destination.label }} <span aria-hidden="true">→</span></span>
      </RouterLink>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()
const firstName = computed(() => auth.user?.name?.trim().split(/\s+/)[0] || '')
const destinations = [
  { name: 'chat', label: 'Chat with AI', paths: ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2V11.5a8.5 8.5 0 0 1 17-1', 'M18 2v6M15 5h6', 'M6 12h7M6 16h9'] },
  { name: 'profile', label: 'Profile', paths: ['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2'] },
  { name: 'faxes', label: 'Faxes', paths: ['M6 9V3h12v6', 'M6 17H3V9h18v8h-3', 'M6 14h12v7H6z', 'M17 11h1'] },
]
</script>
