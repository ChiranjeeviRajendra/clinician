import { onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

export const NOTIFICATION_DURATION_MS = 3000

export const useNotificationsStore = defineStore('notifications', () => {
  const notification = ref(null)
  let timer

  function dismiss() {
    clearTimeout(timer)
    notification.value = null
  }

  function show(message, type = 'success') {
    dismiss()
    notification.value = { message, type }
    timer = setTimeout(dismiss, NOTIFICATION_DURATION_MS)
  }

  onScopeDispose(dismiss)

  return {
    notification, dismiss, show,
    success: (message) => show(message, 'success'),
    warning: (message) => show(message, 'warning'),
    error: (message) => show(message, 'error'),
  }
})
