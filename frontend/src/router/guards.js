import { useAuthStore } from '../stores/auth.js'
import { getReturnTo, loginLocation } from './session.js'

export function installAuthGuards(router) {
  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    const checkingSavedSession = Boolean(auth.sessionToken || (auth.appStatus !== 'ready' && auth.loginReason))
    if (to.meta.requiresAuth) auth.rememberPage(to.fullPath)
    await auth.initializeApp({ force: true })
    if (auth.appStatus !== 'ready') return false
    if (to.meta.requiresAuth && !auth.hasSession()) {
      return loginLocation(auth, to.fullPath)
    }
    if (checkingSavedSession && auth.loginReason && to.name !== 'login') {
      return { name: 'login', query: { reason: auth.loginReason } }
    }
    if (to.meta.guestOnly && auth.hasSession()) return getReturnTo(router, to.query.redirect, auth.returnTo)
    if (to.name === 'login' && auth.loginReason && to.query.reason !== auth.loginReason) {
      return { name: 'login', query: { ...to.query, reason: auth.loginReason } }
    }
  })

  let expirationTimer
  router.afterEach((to, _from, failure) => {
    if (failure) return
    clearTimeout(expirationTimer)
    const auth = useAuthStore()
    if (!to.meta.requiresAuth || !auth.hasSession()) return
    auth.rememberPage(to.fullPath)
    expirationTimer = setTimeout(() => {
      if (!auth.hasSession() && router.currentRoute.value.meta.requiresAuth) {
        router.replace(loginLocation(auth, router.currentRoute.value.fullPath, 'expired'))
      }
    }, Math.max(0, Date.parse(auth.expiresAt) - Date.now()))
  })
}
