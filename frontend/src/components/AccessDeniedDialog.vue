<template>
  <dialog ref="dialog" aria-labelledby="access-denied-title" aria-describedby="access-denied-message" @cancel.prevent="emit('close')">
    <h1 id="access-denied-title">Access denied</h1>
    <p id="access-denied-message">Your session is missing, invalid, or has expired. Please sign in to continue.</p>
    <button class="primary-button" autofocus @click="emit('close')">Close</button>
  </dialog>
</template>

<script setup>
import { onMounted, ref } from 'vue'

const emit = defineEmits(['close'])
const dialog = ref(null)
onMounted(() => dialog.value.showModal())
</script>

<style scoped>
dialog { width: min(440px, calc(100vw - 40px)); margin: auto; padding: 32px; border: 0; border-radius: 20px; color: var(--ink, #252d2a); background: var(--paper, #fffdf8); box-shadow: 0 20px 80px #0003; }
dialog::backdrop { background: #16251dcc; }
h1 { margin: 0 0 16px; font-size: 28px; }
p { margin: 0 0 24px; line-height: 1.6; }
button { width: 100%; }
</style>
