import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/login', name: 'login', component: () => import('../pages/Login.vue'), meta: { guestOnly: true } },
    { path: '/register', redirect: { name: 'login', query: { mode: 'register' } } },
    { path: '/home', name: 'home', component: () => import('../pages/Home.vue'), meta: { requiresAuth: true } },
    { path: '/chat', name: 'chat', component: () => import('../pages/Chat.vue'), meta: { requiresAuth: true } },
    { path: '/profile', name: 'profile', component: () => import('../pages/Profile.vue'), meta: { requiresAuth: true } },
    { path: '/faxes', name: 'faxes', component: () => import('../pages/Faxes.vue'), meta: { requiresAuth: true } },
    ...['verify-email', 'forgot-password', 'reset-password'].map((action) => ({
      path: `/${action}`,
      name: action,
      component: () => import('../pages/AccountAction.vue'),
    })),
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.hasSession()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && auth.hasSession()) return { name: 'home' }
})

let expirationTimer
router.afterEach((to) => {
  clearTimeout(expirationTimer)
  const auth = useAuthStore()
  if (!to.meta.requiresAuth || !auth.hasSession()) return
  expirationTimer = setTimeout(() => {
    if (!auth.hasSession()) {
      router.replace({ name: 'login', query: { expired: '1' } })
    }
  }, Math.max(0, Date.parse(auth.expiresAt) - Date.now()))
})

export default router
