import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/chat' },
    { path: '/login', name: 'login', component: () => import('../pages/Login.vue'), meta: { guestOnly: true } },
    { path: '/register', redirect: { name: 'login', query: { mode: 'register' } } },
    { path: '/chat', name: 'chat', component: () => import('../pages/Chat.vue'), meta: { requiresAuth: true } },
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
  if (to.meta.guestOnly && auth.hasSession()) return { name: 'chat' }
})

export default router
