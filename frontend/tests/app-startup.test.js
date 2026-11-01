import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installAuthGuards } from '../src/router/guards.js'
import { appApi } from '../src/services/app.js'
import { ApiError } from '../src/services/http.js'
import { getReturnTo } from '../src/router/session.js'
import { LOGIN_MESSAGES, RETURN_TO_STORAGE_KEY, SESSION_STORAGE_KEY, useAuthStore } from '../src/stores/auth.js'

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
      { path: '/chat', name: 'chat', component: {}, meta: { requiresAuth: true } },
      { path: '/profile', name: 'profile', component: {}, meta: { requiresAuth: true } },
      { path: '/login', name: 'login', component: {}, meta: { guestOnly: true } },
      { path: '/verify-email', component: {} },
      { path: '/forgot-password', component: {} },
      { path: '/reset-password', component: {} },
      { path: '/:pathMatch(.*)*', redirect: '/home' },
    ],
  })
  installAuthGuards(router)
})

afterEach(async () => {
  // Successful public navigation also clears the session expiration timer.
  useAuthStore().endSession('')
  await router.push('/login')
  mock.timers.reset()
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

test('a revoked token redirects straight to login with an access message and return path', async () => {
  savedSession()
  const check = mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/chat?view=recent#latest')
  const auth = useAuthStore()
  assert.equal(auth.appStatus, 'ready')
  assert.equal(auth.loginReason, 'denied')
  assert.equal(auth.sessionToken, null)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'denied')
  assert.equal(router.currentRoute.value.query.redirect, '/chat?view=recent#latest')
  assert.equal(LOGIN_MESSAGES[auth.loginReason], 'You do not have access to the app. Please login to continue.')
  assert.equal(check.mock.callCount(), 1)
})

test('a missing token skips appInfo and redirects a protected page to login', async () => {
  const check = mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/home')
  assert.equal(check.mock.callCount(), 0)
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.redirect, '/home')
  assert.equal(router.currentRoute.value.query.reason, 'denied')
})

test('an expired saved session cannot restore access', async () => {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    user, sessionToken: 'expired-token', expiresAt: '2020-01-01T00:00:00Z',
  }))
  const check = mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/home')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'expired')
  assert.equal(LOGIN_MESSAGES[useAuthStore().loginReason], 'Your login session expired. Please login to continue.')
  assert.equal(check.mock.callCount(), 0)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
})

test('public account pages remain usable without a session', async () => {
  const check = mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  for (const path of ['/login', '/verify-email', '/forgot-password', '/reset-password']) {
    await router.push(path)
    assert.equal(router.currentRoute.value.path, path)
    assert.equal(useAuthStore().appStatus, 'ready')
  }
  assert.equal(check.mock.callCount(), 0)
})

test('a saved invalid session displays the access message when opening login', async () => {
  savedSession()
  mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/login')
  assert.equal(useAuthStore().appStatus, 'ready')
  assert.equal(router.currentRoute.value.query.reason, 'denied')
})

test('an invalid saved token on a public page redirects to login without blocking recovery links afterward', async () => {
  savedSession()
  const check = mock.method(appApi, 'info', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/forgot-password')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'denied')
  await router.push('/forgot-password')
  assert.equal(router.currentRoute.value.path, '/forgot-password')
  assert.equal(check.mock.callCount(), 1)
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

test('a server-expired token uses the expired message even when client expiry is later', async () => {
  savedSession()
  mock.method(appApi, 'info', async () => { throw new ApiError('Expired', 401, 'session_expired') })
  await router.push('/chat')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'expired')
  assert.equal(router.currentRoute.value.query.redirect, '/chat')
})

test('an in-memory token without a token in tab storage never calls appInfo', async () => {
  const auth = useAuthStore()
  auth.$patch({ user, sessionToken: 'memory-only', expiresAt: info.expires_at })
  const check = mock.method(appApi, 'info', async () => info)
  await auth.initializeApp()
  assert.equal(check.mock.callCount(), 0)
  assert.equal(auth.sessionToken, null)
})

test('a stored token without a cached user is validated by appInfo', async () => {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionToken: 'saved-token' }))
  const check = mock.method(appApi, 'info', async () => info)
  await router.push('/chat')
  assert.equal(router.currentRoute.value.name, 'chat')
  assert.equal(check.mock.calls[0].arguments[0], 'saved-token')
  assert.deepEqual(useAuthStore().user, user)
})

test('the last protected page survives login reload and is used after successful login', async () => {
  await router.push('/chat?view=recent#latest')
  assert.equal(sessionStorage.getItem(RETURN_TO_STORAGE_KEY), '/chat?view=recent#latest')
  setActivePinia(createPinia())
  const auth = useAuthStore()
  assert.equal(auth.returnTo, '/chat?view=recent#latest')
  // The login endpoint establishes a new session before appInfo is called.
  const { authApi } = await import('../src/services/auth.js')
  mock.method(authApi, 'login', async () => ({ ...info, session_token: 'new-token' }))
  mock.method(appApi, 'info', async () => info)
  await auth.signIn({})
  await router.replace(getReturnTo(router, undefined, auth.returnTo))
  assert.equal(router.currentRoute.value.fullPath, '/chat?view=recent#latest')
  assert.equal(auth.loginReason, '')
})

test('a valid session opening login returns to the saved page instead of home', async () => {
  savedSession()
  sessionStorage.setItem(RETURN_TO_STORAGE_KEY, '/profile')
  mock.method(appApi, 'info', async () => info)
  await router.push('/login')
  assert.equal(router.currentRoute.value.name, 'profile')
})

test('only known protected pages can be used as return destinations', () => {
  for (const invalid of ['https://example.com', '//example.com', '/\\example.com', '/login', '/verify-email', '/missing', ['/chat']]) {
    assert.equal(getReturnTo(router, invalid), '/home')
  }
  assert.equal(getReturnTo(router, '/chat?view=recent#latest'), '/chat?view=recent#latest')
  assert.equal(getReturnTo(router, '/login', '/profile'), '/profile')
})

test('client-side expiration routes to login and retains the active page', async () => {
  savedSession()
  mock.method(appApi, 'info', async () => info)
  mock.timers.enable({ apis: ['setTimeout'] })
  await router.push('/chat?view=recent')
  mock.method(Date, 'now', () => Date.parse(info.expires_at) + 1)
  mock.timers.tick(60001)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'expired')
  assert.equal(router.currentRoute.value.query.redirect, '/chat?view=recent')
})
