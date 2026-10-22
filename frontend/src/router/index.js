import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/chat',
      name: 'Chat',
      component: () => import('../pages/Chat.vue'),
    },
  ],
})

export default router