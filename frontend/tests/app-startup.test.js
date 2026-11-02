import { afterEach, beforeEach, mock, test } from 'node:test'
import { setImmediate } from 'node:timers'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installAuthGuards } from '../src/router/guards.js'
import { appApi } from '../src/services/app.js'
import { authApi } from '../src/services/auth.js'
import { ApiError } from '../src/services/http.js'
import { getReturnTo } from '../src/router/session.js'
import { navigateTo } from '../src/router/navigation.js'
import { sendMessage } from '../src/services/chat.js'
import { LOGIN_MESSAGES, RETURN_TO_STORAGE_KEY, SESSION_STORAGE_KEY, useAuthStore } from '../src/stores/auth.js'

const user = { id: 'doctor', email: 'doctor@example.com' }
const info = { name: 'Clinician', status: 'valid', user, expires_at: new Date(Date.now() + 60000).toISOString() }
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
  mock.method(appApi, 'info', async () => info)
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/home' },
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

test('authenticate runs before appInfo, and both finish before the page loads', async () => {
  savedSession()
  const order = []
  let finishAuthentication
  let finishInfo
  mock.method(authApi, 'authenticate', () => {
    order.push('authenticate')
    return new Promise((resolve) => { finishAuthentication = resolve })
  })
  mock.method(appApi, 'info', () => {
    order.push('appInfo')
    return new Promise((resolve) => { finishInfo = resolve })
  })
  const component = mock.fn(async () => { order.push('page'); return { render: () => null } })
  router.addRoute({ path: '/ordered', component, meta: { requiresAuth: true } })
  const navigation = router.push('/ordered')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order, ['authenticate'])
  finishAuthentication({ status: 'valid', expires_at: info.expires_at })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order, ['authenticate', 'appInfo'])
  assert.equal(useAuthStore().isRouteLoading, true)
  finishInfo({ ...info, status: 'ok' })
  await navigation
  assert.deepEqual(order, ['authenticate', 'appInfo', 'page'])
  assert.equal(useAuthStore().isRouteLoading, false)
})

test('appInfo is loaded once across routes and signing out and in, then again on reload', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => ({ status: 'valid', expires_at: info.expires_at }))
  const metadata = mock.method(appApi, 'info', async () => ({ ...info, status: 'ok' }))
  await router.push('/home')
  await router.push('/chat')
  assert.equal(metadata.mock.callCount(), 1)
  assert.equal(check.mock.callCount(), 2)
  const auth = useAuthStore()
  await auth.signOut()
  await router.push('/login')
  mock.method(authApi, 'login', async () => ({ user, session_token: 'new-jwt', expires_at: info.expires_at }))
  await auth.signIn({})
  await router.push('/profile')
  assert.equal(metadata.mock.callCount(), 1)
  assert.equal(check.mock.calls.at(-1).arguments[0], 'new-jwt')
  setActivePinia(createPinia())
  await router.push('/chat')
  assert.equal(metadata.mock.callCount(), 2)
})

test('an appInfo startup failure can retry without caching the failure or clearing the JWT', async () => {
  savedSession()
  mock.method(authApi, 'authenticate', async () => ({ status: 'valid', expires_at: info.expires_at }))
  const metadata = mock.method(appApi, 'info', async () => { throw new ApiError('Unavailable', 503) })
  await router.push('/home')
  assert.equal(useAuthStore().appStatus, 'error')
  assert.equal(useAuthStore().sessionToken, 'saved-token')
  assert.equal(useAuthStore().isRouteLoading, false)
  metadata.mock.mockImplementation(async () => info)
  await router.push('/home')
  await router.push('/chat')
  assert.equal(metadata.mock.callCount(), 2)
  assert.equal(router.currentRoute.value.name, 'chat')
})

test('reload waits for authenticate and appInfo before loading protected page components', async () => {
  savedSession()
  let resolveInfo
  const check = mock.method(authApi, 'authenticate', () => new Promise((resolve) => { resolveInfo = resolve }))
  const loadPage = mock.fn(async () => ({ render: () => null }))
  router.addRoute({ path: '/protected', component: loadPage, meta: { requiresAuth: true } })
  const navigation = router.push('/protected')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(check.mock.calls[0].arguments[0], 'saved-token')
  assert.equal(useAuthStore().appStatus, 'loading')
  assert.equal(useAuthStore().isRouteLoading, true)
  assert.equal(loadPage.mock.callCount(), 0)
  resolveInfo(info)
  await navigation
  assert.equal(useAuthStore().isRouteLoading, false)
  assert.equal(loadPage.mock.callCount(), 1)
  assert.equal(useAuthStore().appInfo.name, 'Clinician')
  assert.equal(useAuthStore().expiresAt, info.expires_at)
})

test('an invalid token redirects straight to login with an access message and return path', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => { throw new ApiError('Unauthorized', 401) })
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

test('a missing token on the first protected-page load redirects silently to login', async () => {
  const check = mock.method(authApi, 'authenticate', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/home')
  assert.equal(check.mock.callCount(), 0)
  assert.equal(useAuthStore().isRouteLoading, false)
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.redirect, '/home')
  assert.equal(router.currentRoute.value.query.reason, undefined)
  assert.equal(useAuthStore().loginReason, '')
})

test('a first visit to the site root reaches login without an authentication message', async () => {
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.deepEqual(router.currentRoute.value.query, { redirect: '/home' })
  assert.equal(useAuthStore().loginReason, '')
  assert.equal(useAuthStore().appStatus, 'ready')
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
  assert.equal(check.mock.callCount(), 0)
  assert.equal(appApi.info.mock.callCount(), 0)
})

test('a first protected deep link without credentials retains its destination silently', async () => {
  await router.push('/chat?view=recent#latest')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.deepEqual(router.currentRoute.value.query, { redirect: '/chat?view=recent#latest' })
  assert.equal(useAuthStore().loginReason, '')
})

test('a later protected navigation without credentials still shows the access message', async () => {
  await router.push('/login')
  await router.push('/chat')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.deepEqual(router.currentRoute.value.query, { reason: 'denied', redirect: '/chat' })
  assert.equal(useAuthStore().loginReason, 'denied')
})

test('an expired saved session cannot restore access', async () => {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    user, sessionToken: 'expired-token', expiresAt: '2020-01-01T00:00:00Z',
  }))
  const check = mock.method(authApi, 'authenticate', async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/home')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'expired')
  assert.equal(LOGIN_MESSAGES[useAuthStore().loginReason], 'Your login session expired. Please login to continue.')
  assert.equal(check.mock.callCount(), 0)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
})

test('public account pages remain usable without a session', async () => {
  const check = mock.method(authApi, 'authenticate', async () => { throw new ApiError('Unauthorized', 401) })
  for (const path of ['/login', '/verify-email', '/forgot-password', '/reset-password']) {
    await router.push(path)
    assert.equal(router.currentRoute.value.path, path)
    assert.equal(useAuthStore().appStatus, 'ready')
  }
  assert.equal(check.mock.callCount(), 0)
})

for (const code of ['unauthorized', 'session_expired']) {
  test(`opening login silently clears a saved token rejected as ${code}`, async () => {
    savedSession()
    const check = mock.method(authApi, 'authenticate', async () => { throw new ApiError('Unauthorized', 401, code) })
    await router.push('/login?reason=expired&expired=1&redirect=%2Fchat&mode=register#form')
    const auth = useAuthStore()
    assert.equal(auth.appStatus, 'ready')
    assert.equal(auth.loginReason, '')
    assert.equal(auth.appError, '')
    assert.equal(auth.user, null)
    assert.equal(auth.sessionToken, null)
    assert.equal(auth.expiresAt, null)
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
    assert.equal(router.currentRoute.value.name, 'login')
    assert.deepEqual(router.currentRoute.value.query, { redirect: '/chat', mode: 'register' })
    assert.equal(router.currentRoute.value.hash, '#form')
    assert.equal(check.mock.callCount(), 1)
    assert.equal(appApi.info.mock.callCount(), 0)
  })
}

for (const [kind, stored] of [
  ['missing', null],
  ['invalid JSON', 'bad-json'],
  ['missing token', '{}'],
  ['blank token', JSON.stringify({ sessionToken: ' ' })],
  ['invalid expiry', JSON.stringify({ user, sessionToken: 'saved-token', expiresAt: 'invalid' })],
]) {
  test(`opening login with ${kind} credentials clears them without an authentication message`, async () => {
    if (stored !== null) sessionStorage.setItem(SESSION_STORAGE_KEY, stored)
    const check = mock.method(authApi, 'authenticate', async () => info)
    await router.push('/login?reason=denied&expired=1&redirect=%2Fprofile')
    const auth = useAuthStore()
    assert.equal(auth.appStatus, 'ready')
    assert.equal(auth.loginReason, '')
    assert.equal(auth.appError, '')
    assert.equal(auth.isAuthenticated, false)
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
    assert.equal(router.currentRoute.value.name, 'login')
    assert.deepEqual(router.currentRoute.value.query, { redirect: '/profile' })
    assert.equal(check.mock.callCount(), 0)
    assert.equal(appApi.info.mock.callCount(), 0)
  })
}

test('opening login without a stored token also clears an in-memory session silently', async () => {
  const auth = useAuthStore()
  auth.$patch({ user, sessionToken: 'memory-only', expiresAt: info.expires_at, loginReason: 'denied' })
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/login')
  assert.equal(auth.sessionToken, null)
  assert.equal(auth.user, null)
  assert.equal(auth.expiresAt, null)
  assert.equal(auth.loginReason, '')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(check.mock.callCount(), 0)
})

for (const serverValid of [false, true]) {
  test(`opening login checks a locally expired token and preserves its lifetime limit (server valid: ${serverValid})`, async () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      user, sessionToken: 'expired-token', expiresAt: '2020-01-01T00:00:00Z',
    }))
    const check = mock.method(authApi, 'authenticate', async () => {
      if (!serverValid) throw new ApiError('Expired', 401, 'session_expired')
      return info
    })
    await router.push('/login?reason=expired')
    assert.equal(check.mock.callCount(), 1)
    assert.equal(check.mock.calls[0].arguments[0], 'expired-token')
    assert.equal(useAuthStore().loginReason, '')
    assert.equal(useAuthStore().sessionToken, null)
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
    assert.equal(router.currentRoute.value.fullPath, '/login')
  })
}

for (const failure of [
  new ApiError('Offline', 0),
  new ApiError('Timed out', 0, 'request_timeout'),
  new ApiError('Unavailable', 503),
]) {
  test(`opening login preserves credentials on ${failure.message} and retries the original redirect`, async () => {
    savedSession()
    sessionStorage.setItem(RETURN_TO_STORAGE_KEY, '/profile')
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
    const check = mock.method(authApi, 'authenticate', async () => { throw failure })
    const location = '/login?reason=expired&redirect=%2Fchat%3Fview%3Drecent%23latest'
    await router.push(location)
    const auth = useAuthStore()
    assert.equal(auth.appStatus, 'error')
    assert.equal(auth.appError, failure.message)
    assert.equal(auth.sessionToken, 'saved-token')
    assert.equal(auth.isRouteLoading, false)
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), stored)
    assert.equal(appApi.info.mock.callCount(), 0)
    check.mock.mockImplementation(async () => info)
    await router.replace(location)
    assert.equal(auth.appStatus, 'ready')
    assert.equal(auth.appError, '')
    assert.equal(auth.loginReason, '')
    assert.equal(router.currentRoute.value.fullPath, '/chat?view=recent#latest')
    assert.equal(appApi.info.mock.callCount(), 1)
  })
}

test('opening login preserves credentials when appInfo fails and retries successfully', async () => {
  savedSession()
  mock.method(authApi, 'authenticate', async () => info)
  const metadata = mock.method(appApi, 'info', async () => { throw new ApiError('Unavailable', 503) })
  await router.push('/login')
  assert.equal(useAuthStore().appStatus, 'error')
  assert.equal(useAuthStore().sessionToken, 'saved-token')
  assert.notEqual(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
  metadata.mock.mockImplementation(async () => info)
  await router.replace('/login')
  assert.equal(router.currentRoute.value.name, 'home')
  assert.equal(useAuthStore().appStatus, 'ready')
  assert.equal(metadata.mock.callCount(), 2)
})

test('a canceled initial login check cannot restore cleared credentials or redirect later', async () => {
  savedSession()
  let resolveCheck
  let signal
  mock.method(authApi, 'authenticate', (_token, options) => {
    signal = options.signal
    return new Promise((resolve) => { resolveCheck = resolve })
  })
  const navigation = router.push('/login?redirect=%2Fprofile')
  await new Promise((resolve) => setImmediate(resolve))
  const auth = useAuthStore()
  auth.endSession('')
  await router.push('/forgot-password')
  assert.equal(signal.aborted, true)
  resolveCheck(info)
  await navigation
  assert.equal(router.currentRoute.value.path, '/forgot-password')
  assert.equal(auth.sessionToken, null)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
  assert.equal(appApi.info.mock.callCount(), 0)
})

test('an invalid saved token on a public page redirects to login without blocking recovery links afterward', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => { throw new ApiError('Unauthorized', 401) })
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
    const check = mock.method(authApi, 'authenticate', async () => { throw new ApiError('Service unavailable', status) })
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
  const check = mock.method(authApi, 'authenticate', () => new Promise((resolve) => { resolveInfo = resolve }))
  const auth = useAuthStore()
  const first = auth.initializeApp()
  const second = auth.initializeApp()
  assert.equal(check.mock.callCount(), 1)
  assert.equal(auth.isRouteLoading, true)
  resolveInfo(info)
  await Promise.all([first, second])
  assert.equal(auth.isRouteLoading, false)
  assert.equal(auth.appStatus, 'ready')
})

test('revalidation never extends the saved client expiration', async () => {
  savedSession()
  mock.method(authApi, 'authenticate', async () => ({
    ...info, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  }))
  await useAuthStore().initializeApp()
  assert.equal(useAuthStore().expiresAt, info.expires_at)
})

test('a valid saved session on login redirects to home after validation', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/login')
  assert.equal(router.currentRoute.value.name, 'home')
  assert.equal(check.mock.callCount(), 2)
})

test('every navigation with a saved token rechecks authenticate and loads appInfo once, including query and fragment changes', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  const paths = ['/home', '/chat', '/profile', '/profile?tab=details', '/profile?tab=details#settings']
  for (const [index, path] of paths.entries()) {
    await router.push(path)
    assert.equal(router.currentRoute.value.fullPath, path)
    assert.equal(check.mock.callCount(), index + 1)
    assert.equal(check.mock.calls[index].arguments[0], 'saved-token')
    assert.equal(appApi.info.mock.callCount(), 1)
  }
})

test('navigation waits for revalidation while keeping the current page mounted', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/home')
  let resolveInfo
  check.mock.mockImplementation(() => new Promise((resolve) => { resolveInfo = resolve }))
  const navigation = router.push('/chat')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(check.mock.callCount(), 2)
  assert.equal(router.currentRoute.value.name, 'home')
  assert.equal(useAuthStore().appStatus, 'ready')
  assert.equal(useAuthStore().isRouteLoading, true)
  resolveInfo(info)
  await navigation
  assert.equal(router.currentRoute.value.name, 'chat')
  assert.equal(useAuthStore().isRouteLoading, false)
})

for (const status of [0, 401, 503]) {
  test(`the route loader clears after an authenticate ${status || 'network'} failure`, async () => {
    savedSession()
    const check = mock.method(authApi, 'authenticate', async () => info)
    await router.push('/home')
    let rejectInfo
    check.mock.mockImplementation(() => new Promise((_resolve, reject) => { rejectInfo = reject }))
    const navigation = router.push('/chat')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(useAuthStore().isRouteLoading, true)
    rejectInfo(new ApiError('Request failed', status))
    await navigation
    assert.equal(useAuthStore().isRouteLoading, false)
    assert.equal(status === 401 ? router.currentRoute.value.name : useAuthStore().appStatus, status === 401 ? 'login' : 'error')
  })
}

for (const status of [0, 503]) {
  test(`a later ${status || 'network'} failure can retry the current URL without losing credentials`, async () => {
    savedSession()
    const check = mock.method(authApi, 'authenticate', async () => info)
    await router.push('/home?view=recent#top')
    check.mock.mockImplementation(async () => { throw new ApiError('Service unavailable', status) })
    await router.push('/chat')
    assert.equal(useAuthStore().appStatus, 'error')
    assert.equal(router.currentRoute.value.fullPath, '/home?view=recent#top')
    assert.equal(useAuthStore().sessionToken, 'saved-token')
    check.mock.mockImplementation(async () => info)
    const { path, query, hash } = router.currentRoute.value
    await router.replace({ path, query, hash, force: true })
    assert.equal(check.mock.callCount(), 3)
    assert.equal(useAuthStore().appStatus, 'ready')
    assert.equal(router.currentRoute.value.fullPath, '/home?view=recent#top')
  })
}

for (const code of ['unauthorized', 'session_expired']) {
  test(`a ${code} session found on later navigation routes to login and remembers the target`, async () => {
    savedSession()
    const check = mock.method(authApi, 'authenticate', async () => info)
    await router.push('/home')
    check.mock.mockImplementation(async () => { throw new ApiError('Unauthorized', 401, code) })
    await router.push('/chat?view=recent#latest')
    assert.equal(check.mock.callCount(), 2)
    assert.equal(router.currentRoute.value.name, 'login')
    assert.equal(router.currentRoute.value.query.reason, code === 'session_expired' ? 'expired' : 'denied')
    assert.equal(router.currentRoute.value.query.redirect, '/chat?view=recent#latest')
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
  })
}

test('an invalid session on a later public navigation also routes to login', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/home')
  check.mock.mockImplementation(async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/forgot-password')
  assert.equal(check.mock.callCount(), 2)
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'denied')
})

test('a delayed revalidation cannot restore a signed-out session', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/home')
  let resolveInfo
  check.mock.mockImplementation(() => new Promise((resolve) => { resolveInfo = resolve }))
  const navigation = router.push('/chat')
  await new Promise((resolve) => setImmediate(resolve))
  const auth = useAuthStore()
  auth.endSession('')
  await router.push('/login')
  resolveInfo(info)
  await navigation
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(auth.sessionToken, null)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
})

test('selecting another navbar item aborts the old request and loads only the new selection', async () => {
  savedSession()
  mock.method(globalThis, 'fetch', async () => Response.json(info))
  await router.push('/home')
  const requests = []
  mock.method(globalThis, 'fetch', (_url, options) => new Promise((resolve, reject) => {
    requests.push({ signal: options.signal, resolve })
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const auth = useAuthStore()
  const first = navigateTo(router, auth, '/chat')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(auth.pendingRoute, '/chat')
  assert.equal(auth.isRouteLoading, true)
  const second = navigateTo(router, auth, '/profile')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests.length, 2)
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[1].signal.aborted, false)
  assert.equal(auth.pendingRoute, '/profile')
  assert.equal(auth.isRouteLoading, true)
  requests[1].resolve(Response.json({ ...info, name: 'Latest application info' }))
  await Promise.all([first, second])
  assert.equal(router.currentRoute.value.name, 'profile')
  assert.equal(auth.appInfo.name, 'Clinician')
  assert.equal(auth.isRouteLoading, false)
  assert.equal(auth.appError, '')
  assert.equal(auth.pendingRoute, null)
})

test('clicking the currently selected navbar item does not start a request', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/chat?view=recent#latest')
  await navigateTo(router, useAuthStore(), '/chat')
  assert.equal(check.mock.callCount(), 1)
  assert.equal(router.currentRoute.value.fullPath, '/chat?view=recent#latest')
})

test('changing navbar selection also cancels the previous page API request', async () => {
  savedSession()
  mock.method(authApi, 'authenticate', async () => info)
  await router.push('/chat')
  let signal
  mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const canceled = assert.rejects(sendMessage('A question', 'saved-token'), (error) => error.code === 'request_cancelled')
  await navigateTo(router, useAuthStore(), '/profile')
  await canceled
  assert.equal(signal.aborted, true)
  assert.equal(router.currentRoute.value.name, 'profile')
})

test('repeating a pending navbar selection keeps its original request running', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/home')
  let resolveInfo
  let signal
  check.mock.mockImplementation((_token, options) => {
    signal = options.signal
    return new Promise((resolve) => { resolveInfo = resolve })
  })
  const auth = useAuthStore()
  const first = navigateTo(router, auth, '/profile')
  await new Promise((resolve) => setImmediate(resolve))
  await navigateTo(router, auth, '/profile')
  assert.equal(check.mock.callCount(), 2)
  assert.equal(signal.aborted, false)
  assert.equal(auth.pendingRoute, '/profile')
  resolveInfo(info)
  await first
  assert.equal(router.currentRoute.value.name, 'profile')
})

test('rapid switching back to an earlier target does not let its old request clear the new selection', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/home')
  const requests = []
  check.mock.mockImplementation((_token, { signal }) => new Promise((resolve) => {
    requests.push({ signal, resolve })
  }))
  const auth = useAuthStore()
  const first = navigateTo(router, auth, '/chat')
  await new Promise((resolve) => setImmediate(resolve))
  const second = navigateTo(router, auth, '/profile')
  await new Promise((resolve) => setImmediate(resolve))
  const third = navigateTo(router, auth, '/chat')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(requests[1].signal.aborted, true)
  assert.equal(requests[2].signal.aborted, false)
  requests[0].resolve(info)
  await first
  assert.equal(auth.pendingRoute, '/chat')
  await navigateTo(router, auth, '/chat')
  assert.equal(requests.length, 3)
  requests[1].resolve(info)
  requests[2].resolve(info)
  await Promise.all([second, third])
  assert.equal(router.currentRoute.value.name, 'chat')
  assert.equal(auth.pendingRoute, null)
  assert.equal(auth.isRouteLoading, false)
})

test('selecting the current page while another page loads cancels that navigation', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/home')
  let rejectOld
  let oldSignal
  check.mock.mockImplementation((_token, options) => {
    oldSignal = options.signal
    return new Promise((_resolve, reject) => { rejectOld = reject })
  })
  const auth = useAuthStore()
  const first = navigateTo(router, auth, '/profile')
  await new Promise((resolve) => setImmediate(resolve))
  check.mock.mockImplementation(async () => info)
  await navigateTo(router, auth, '/home')
  assert.equal(oldSignal.aborted, true)
  assert.equal(router.currentRoute.value.name, 'home')
  assert.equal(auth.pendingRoute, null)
  assert.equal(auth.isRouteLoading, false)
  // Even an old transport that rejects late cannot display an error.
  rejectOld(new ApiError('Late service failure', 503))
  await first
  assert.equal(auth.appStatus, 'ready')
  assert.equal(auth.appError, '')
})

for (const staleResult of ['success', 'unauthorized']) {
  test(`a canceled request's late ${staleResult} cannot overwrite the latest selection`, async () => {
    savedSession()
    const check = mock.method(authApi, 'authenticate', async () => info)
    await router.push('/home')
    let resolveOld
    let rejectOld
    check.mock.mockImplementation(() => new Promise((resolve, reject) => {
      resolveOld = resolve
      rejectOld = reject
    }))
    const auth = useAuthStore()
    const first = navigateTo(router, auth, '/chat')
    await new Promise((resolve) => setImmediate(resolve))
    check.mock.mockImplementation(async () => ({ ...info, name: 'Latest' }))
    await navigateTo(router, auth, '/profile')
    assert.equal(auth.isRouteLoading, false)
    if (staleResult === 'success') resolveOld({ ...info, name: 'Outdated' })
    else rejectOld(new ApiError('Unauthorized', 401))
    await first
    assert.equal(router.currentRoute.value.name, 'profile')
    assert.equal(auth.appInfo.name, 'Clinician')
    assert.equal(auth.sessionToken, 'saved-token')
    assert.equal(auth.appError, '')
  })
}

test('a server-expired token uses the expired message even when client expiry is later', async () => {
  savedSession()
  mock.method(authApi, 'authenticate', async () => { throw new ApiError('Expired', 401, 'session_expired') })
  await router.push('/chat')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'expired')
  assert.equal(router.currentRoute.value.query.redirect, '/chat')
})

test('an in-memory token without a token in tab storage never calls appInfo', async () => {
  const auth = useAuthStore()
  auth.$patch({ user, sessionToken: 'memory-only', expiresAt: info.expires_at })
  const check = mock.method(authApi, 'authenticate', async () => info)
  await auth.initializeApp()
  assert.equal(check.mock.callCount(), 0)
  assert.equal(auth.sessionToken, null)
})

test('a stored token without a cached user is validated by appInfo', async () => {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionToken: 'saved-token' }))
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/chat')
  assert.equal(router.currentRoute.value.name, 'chat')
  assert.equal(check.mock.calls[0].arguments[0], 'saved-token')
  assert.deepEqual(useAuthStore().user, user)
})

test('the last protected page survives login reload and is used after successful login', async () => {
  await router.push('/chat?view=recent#latest')
  assert.equal(sessionStorage.getItem(RETURN_TO_STORAGE_KEY), '/chat?view=recent#latest')
  setActivePinia(createPinia())
  mock.method(authApi, 'authenticate', async () => info)
  const auth = useAuthStore()
  assert.equal(auth.returnTo, '/chat?view=recent#latest')
  // The login endpoint establishes a new session before appInfo is called.
  mock.method(authApi, 'login', async () => ({ ...info, session_token: 'new-token' }))
  mock.method(authApi, 'authenticate', async () => info)
  await auth.signIn({})
  await router.replace(getReturnTo(router, undefined, auth.returnTo))
  assert.equal(router.currentRoute.value.fullPath, '/chat?view=recent#latest')
  assert.equal(auth.loginReason, '')
})

test('a valid session opening login without a URL redirect ignores the saved page and goes home', async () => {
  savedSession()
  sessionStorage.setItem(RETURN_TO_STORAGE_KEY, '/profile')
  mock.method(authApi, 'authenticate', async () => info)
  await router.push('/login')
  assert.equal(router.currentRoute.value.name, 'home')
})

test('a valid session opening login follows the URL redirect with its query and hash', async () => {
  savedSession()
  sessionStorage.setItem(RETURN_TO_STORAGE_KEY, '/profile')
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/login?redirect=%2Fchat%3Fview%3Drecent%23latest')
  assert.equal(router.currentRoute.value.fullPath, '/chat?view=recent#latest')
  assert.equal(check.mock.calls[0].arguments[0], 'saved-token')
  assert.equal(appApi.info.mock.callCount(), 1)
})

for (const redirect of ['https://example.com', '//example.com', '/\\example.com', '/login', '/missing']) {
  test(`a valid session opening login with redirect ${redirect} falls back to home`, async () => {
    savedSession()
    sessionStorage.setItem(RETURN_TO_STORAGE_KEY, '/profile')
    mock.method(authApi, 'authenticate', async () => info)
    await router.push({ name: 'login', query: { redirect } })
    assert.equal(router.currentRoute.value.name, 'home')
  })
}

test('routing to login within the app still uses the saved last page', async () => {
  savedSession()
  mock.method(authApi, 'authenticate', async () => info)
  await router.push('/home')
  useAuthStore().rememberPage('/profile')
  await router.push('/login')
  assert.equal(router.currentRoute.value.name, 'profile')
})

test('routing to login within the app still shows a rejected session message', async () => {
  savedSession()
  const check = mock.method(authApi, 'authenticate', async () => info)
  await router.push('/home')
  check.mock.mockImplementation(async () => { throw new ApiError('Unauthorized', 401) })
  await router.push('/login')
  assert.equal(router.currentRoute.value.query.reason, 'denied')
  assert.equal(useAuthStore().loginReason, 'denied')
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
  mock.method(authApi, 'authenticate', async () => info)
  mock.timers.enable({ apis: ['setTimeout'] })
  await router.push('/chat?view=recent')
  mock.method(Date, 'now', () => Date.parse(info.expires_at) + 1)
  mock.timers.tick(60001)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'expired')
  assert.equal(router.currentRoute.value.query.redirect, '/chat?view=recent')
})
