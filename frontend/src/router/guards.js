import { START_LOCATION } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { getReturnTo, loginLocation } from './session.js'
import { cancelRouteRequests } from '../services/route-requests.js'

export function installAuthGuards(router) {
  let navigation = 0
  let controller
  let pendingLocation
  router.beforeEach(async (to, from) => {
    const auth = useAuthStore()
    const initialLogin = from === START_LOCATION && to.name === 'login' && !to.redirectedFrom
    const currentNavigation = ++navigation
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    cancelRouteRequests()
    pendingLocation = to
    auth.pendingRoute = to.fullPath
    const checkingSavedSession = Boolean(auth.sessionToken || (auth.appStatus !== 'ready' && auth.loginReason))
    if (to.meta.requiresAuth) auth.rememberPage(to.fullPath)
    await auth.initializeApp({ force: true, signal, initialLogin })
    if (signal.aborted || currentNavigation !== navigation) return false
    if (auth.appStatus !== 'ready') return false
    if (initialLogin) {
      if (auth.hasSession()) return getReturnTo(router, to.query.redirect)
      auth.loginReason = ''
      if ('reason' in to.query || 'expired' in to.query) {
        const query = { ...to.query }
        delete query.reason
        delete query.expired
        return { path: to.path, query, hash: to.hash, replace: true }
      }
      return
    }
    if (to.meta.requiresAuth && !auth.hasSession()) {
      const reason = from === START_LOCATION && !checkingSavedSession ? '' : auth.loginReason || 'denied'
      return loginLocation(auth, to.fullPath, reason)
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
