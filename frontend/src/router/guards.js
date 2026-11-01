import { useAuthStore } from '../stores/auth.js'

export function installAuthGuards(router) {
  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    await auth.initializeApp({ allowAnonymous: !to.meta.requiresAuth && !auth.sessionToken })
    if (auth.appStatus !== 'ready') return false
    if (to.meta.requiresAuth && !auth.hasSession()) {
      auth.denyAccess()
      return false
    }
    if (to.meta.guestOnly && auth.hasSession()) return { name: 'home' }
  })

  let expirationTimer
  router.afterEach((to, _from, failure) => {
    if (failure) return
    clearTimeout(expirationTimer)
    const auth = useAuthStore()
    if (!to.meta.requiresAuth || !auth.hasSession()) return
    expirationTimer = setTimeout(() => {
      if (!auth.hasSession()) auth.denyAccess()
    }, Math.max(0, Date.parse(auth.expiresAt) - Date.now()))
  })
}
