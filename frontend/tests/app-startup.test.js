import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, isNavigationFailure } from 'vue-router'
import { installAuthGuards } from '../src/router/guards.js'
import { appApi } from '../src/services/app.js'
import { ApiError } from '../src/services/http.js'
import { SESSION_STORAGE_KEY, useAuthStore } from '../src/stores/auth.js'

const user = { id: 'doctor', email: 'doctor@example.com' }
const info = { name: 'Clinician', user, expires_at: new Date(Date.now() + 60000).toISOString() }
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
let router

beforeEach(() => {
  const values = new Map()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  })
  setActivePinia(createPinia())
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/home', name: 'home', component: {}, meta: { requiresAuth: true } },
      { path: '/login', name: 'login', component: {}, meta: { guestOnly: true } },
      { path: '/verify-email', component: {} },
      { path: '/forgot-password', component: {} },
      { path: '/reset-password', component: {} },
    ],
  })
  installAuthGuards(router)
})

afterEach(async () => {
  // Successful public navigation also clears the session expiration timer.
  useAuthStore().clearSession()
  useAuthStore().dismissAccessDenied()
  await router.push('/login')
  mock.restoreAll()
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage)
  else delete globalThis.sessionStorage
})

function savedSession() {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    user, sessionToken: 'saved-token', expiresAt: info.expires_at,
  }))
}

test('reload waits for appInfo before loading protected page components', async () => {
  savedSession()
  let resolveInfo
  const check = mock.method(appApi, 'info', () => new Promise((resolve) => { resolveInfo = resolve }))
  const loadPage = mock.fn(async () => ({ render: () => null }))
  router.addRoute({ path: '/protected', component: loadPage, meta: { requiresAuth: true } })
  const navigation = router.push('/protected')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(check.mock.calls[0].arguments[0], 'saved-token')
  assert.equal(useAuthStore().appStatus, 'loading')
  assert.equal(loadPage.mock.callCount(), 0)
  resolveInfo(info)
  await navigation
  assert.equal(loadPage.mock.callCount(), 1)
  assert.equal(useAuthStore().appInfo.name, 'Clinician')
  assert.equal(useAuthStore().expiresAt, info.expires_at)
})

test('a revoked token blocks navigation until the denied popup is dismissed', async () => {
  savedSession()
  const check = mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  assert.ok(isNavigationFailure(await router.push('/home')))
  const auth = useAuthStore()
  assert.equal(auth.appStatus, 'denied')
  assert.equal(auth.sessionToken, null)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
  assert.notEqual(router.currentRoute.value.name, 'login')
  auth.dismissAccessDenied()
  await router.replace({ name: 'login' })
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(check.mock.callCount(), 1)
})

test('a missing token still calls appInfo first and denies a protected page', async () => {
  const check = mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/home')
  assert.equal(check.mock.calls[0].arguments[0], null)
  assert.equal(useAuthStore().appStatus, 'denied')
})

test('an expired saved session cannot restore access', async () => {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    user, sessionToken: 'expired-token', expiresAt: '2020-01-01T00:00:00Z',
  }))
  mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/home')
  assert.equal(useAuthStore().appStatus, 'denied')
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
})

test('public account pages remain usable without a session', async () => {
  const check = mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  for (const path of ['/login', '/verify-email', '/forgot-password', '/reset-password']) {
    await router.push(path)
    assert.equal(router.currentRoute.value.path, path)
    assert.equal(useAuthStore().appStatus, 'ready')
  }
  assert.equal(check.mock.callCount(), 1)
})

test('a saved invalid session shows the popup even when opening login', async () => {
  savedSession()
  mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/login')
  assert.equal(useAuthStore().appStatus, 'denied')
})

for (const status of [0, 503]) {
  test(`a ${status || 'network'} failure blocks content and supports retry without logging out`, async () => {
    savedSession()
    const check = mock.method(appApi, 'info', async () => { throw new ApiError('Service unavailable', status) })
    await router.push('/home')
    const auth = useAuthStore()
    assert.equal(auth.appStatus, 'error')
    assert.equal(auth.sessionToken, 'saved-token')
    assert.notEqual(router.currentRoute.value.name, 'home')
    check.mock.mockImplementation(async () => info)
    await router.replace('/home')
    assert.equal(auth.appStatus, 'ready')
    assert.equal(router.currentRoute.value.name, 'home')
    assert.equal(check.mock.callCount(), 2)
  })
}

test('simultaneous initialization requests share one check', async () => {
  savedSession()
  let resolveInfo
  const check = mock.method(appApi, 'info', () => new Promise((resolve) => { resolveInfo = resolve }))
  const auth = useAuthStore()
  const first = auth.initializeApp()
  const second = auth.initializeApp()
  assert.equal(check.mock.callCount(), 1)
  resolveInfo(info)
  await Promise.all([first, second])
  assert.equal(auth.appStatus, 'ready')
})

test('revalidation never extends the saved client expiration', async () => {
  savedSession()
  mock.method(appApi, 'info', async () => ({
    ...info, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  }))
  await useAuthStore().initializeApp()
  assert.equal(useAuthStore().expiresAt, info.expires_at)
})

test('a valid saved session on login redirects to home after validation', async () => {
  savedSession()
  const check = mock.method(appApi, 'info', async () => info)
  await router.push('/login')
  assert.equal(router.currentRoute.value.name, 'home')
  assert.equal(check.mock.callCount(), 1)
})
