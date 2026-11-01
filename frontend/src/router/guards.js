import { useAuthStore } from '../stores/auth.js'
import { getReturnTo, loginLocation } from './session.js'
import { cancelRouteRequests } from '../services/route-requests.js'

export function installAuthGuards(router) {
  let navigation = 0
  let controller
  let pendingLocation
  router.beforeEach(async (to) => {
    const auth = useAuthStore()
    const currentNavigation = ++navigation
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    cancelRouteRequests()
    pendingLocation = to
    auth.pendingRoute = to.fullPath
    const checkingSavedSession = Boolean(auth.sessionToken || (auth.appStatus !== 'ready' && auth.loginReason))
    if (to.meta.requiresAuth) auth.rememberPage(to.fullPath)
    await auth.initializeApp({ force: true, signal })
    if (signal.aborted || currentNavigation !== navigation) return false
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
    const auth = useAuthStore()
    if (pendingLocation === to) {
      auth.pendingRoute = null
      pendingLocation = null
    }
    if (failure) return
    clearTimeout(expirationTimer)
    if (!to.meta.requiresAuth || !auth.hasSession()) return
    auth.rememberPage(to.fullPath)
    expirationTimer = setTimeout(() => {
      if (!auth.hasSession() && router.currentRoute.value.meta.requiresAuth) {
        router.replace(loginLocation(auth, router.currentRoute.value.fullPath, 'expired'))
      }
    }, Math.max(0, Date.parse(auth.expiresAt) - Date.now()))
  })
}
