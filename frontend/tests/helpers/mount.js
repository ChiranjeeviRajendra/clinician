import { setImmediate } from 'node:timers'
import { createRenderer } from 'vue'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

export const flushPromises = () => new Promise((resolve) => setImmediate(resolve))

// Exercise composable lifecycle hooks without a browser or real HTTP requests.
export async function mountComposable(context, setup, { routes, location, configure } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  configure?.()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(location)
  let state
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {} })
  const app = renderer.createApp({
    setup() {
      state = setup()
      return () => null
    },
  })
  app.use(pinia).use(router).mount({})
  let mounted = true
  const unmount = () => {
    if (!mounted) return
    mounted = false
    app.unmount()
    disposePinia(pinia)
  }
  context.after(unmount)
  await flushPromises()
  return { state, router, unmount }
}
