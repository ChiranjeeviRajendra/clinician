<template>
  <div class="notification-region" :role="notifications.notification?.type === 'error' ? 'alert' : 'status'" :aria-live="notifications.notification?.type === 'error' ? 'assertive' : 'polite'" aria-atomic="true">
    <Transition name="notification">
      <div v-if="notifications.notification" class="notification-popup" :class="notifications.notification.type">
        <span class="notification-icon" aria-hidden="true">{{ icons[notifications.notification.type] }}</span>
        <div class="notification-content">
          <strong>{{ labels[notifications.notification.type] }}</strong>
          <p>{{ notifications.notification.message }}</p>
        </div>
        <button type="button" class="notification-dismiss" aria-label="Dismiss notification" @click="notifications.dismiss">&times;</button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { useNotificationsStore } from '../stores/notifications.js'

const notifications = useNotificationsStore()
const labels = { success: 'Success', warning: 'Warning', error: 'Error' }
const icons = { success: '\u2713', warning: '!', error: '\u00d7' }
</script>

<style scoped>
.notification-region { position: fixed; top: max(16px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); width: calc(100% - 32px); max-width: 440px; z-index: 1000; pointer-events: none; }
.notification-popup { display: flex; align-items: flex-start; gap: 12px; padding: 16px; border: 1px solid #cfe2d5; border-left: 4px solid #367650; border-radius: 10px; background: #f1f8f0; color: #285b3c; box-shadow: 0 8px 30px #203c3626; pointer-events: auto; }
.notification-popup.warning { border-color: #eedcaf; border-left-color: #a87317; background: #fff9eb; color: #78520e; }
.notification-popup.error { border-color: #f0d7ce; border-left-color: #b55445; background: #fff2ee; color: #8e3f36; }
.notification-icon { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid currentColor; border-radius: 50%; flex-shrink: 0; font-size: 15px; font-weight: 700; }
.notification-content { min-width: 0; flex: 1; }
.notification-content strong { display: block; font-size: 12px; margin-bottom: 5px; }
.notification-content p { font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.notification-dismiss { flex-shrink: 0; border: 0; background: transparent; color: inherit; width: 24px; height: 24px; padding: 0; font-size: 22px; line-height: 1; }
.notification-enter-active, .notification-leave-active { transition: opacity .18s, transform .18s; }
.notification-enter-from, .notification-leave-to { opacity: 0; transform: translateY(-8px); }
@media (prefers-reduced-motion: reduce) {
  .notification-enter-active, .notification-leave-active { transition: none; }
}
</style>
