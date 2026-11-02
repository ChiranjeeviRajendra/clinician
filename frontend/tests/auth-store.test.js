import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { authApi } from '../src/services/auth.js'
import { userApi } from '../src/services/user.js'
import { ApiError } from '../src/services/http.js'
import { SESSION_STORAGE_KEY, useAuthStore } from '../src/stores/auth.js'

const user = { id: 'test-user', email: 'doctor@example.com' }
const session = { user, session_token: 'test-token', expires_at: new Date(Date.now() + 3600000).toISOString() }

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
beforeEach(() => {
  const values = new Map()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  })
  setActivePinia(createPinia())
})
afterEach(() => {
  mock.restoreAll()
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage)
  else delete globalThis.sessionStorage
})

test('sign in saves the JWT and defers userInfo to route initialization', async () => {
  mock.method(authApi, 'login', async () => session)
  const profile = mock.method(userApi, 'info', async () => ({ email: user.email, email_verified: true, expires_at: session.expires_at }))
  const check = mock.method(authApi, 'authenticate', async () => ({}))
  const auth = useAuthStore()
  await auth.signIn({ email: user.email, password: 'test-password' })
  assert.equal(profile.mock.callCount(), 0)
  assert.equal(check.mock.callCount(), 0)
  assert.equal(auth.user.email, user.email)
  assert.equal(auth.hasSession(), true)
  const saved = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY))
  assert.equal(saved.sessionToken, session.session_token)
  assert.equal('password' in saved, false)
})

test('a failed login leaves no client session', async () => {
  mock.method(authApi, 'login', async () => { throw new ApiError('Unauthorized', 401) })
  const auth = useAuthStore()
  await assert.rejects(auth.signIn({}))
  assert.equal(auth.sessionToken, null)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
})

test('stateless sign out clears credentials without a server call', async () => {
  const logout = mock.method(authApi, 'logout', async () => { throw new ApiError('Offline', 0) })
  const auth = useAuthStore()
  auth.$patch({ user, sessionToken: session.session_token, expiresAt: session.expires_at })
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ user, sessionToken: session.session_token, expiresAt: session.expires_at }))
  await auth.signOut()
  assert.equal(logout.mock.callCount(), 0)
  assert.equal(auth.isAuthenticated, false)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
})

test('expired credentials cannot pass the client route guard', () => {
  const auth = useAuthStore()
  auth.$patch({ user, sessionToken: session.session_token, expiresAt: '2020-01-01T00:00:00Z' })
  assert.equal(auth.hasSession(), false)
  assert.equal(auth.user, null)
})

test('a page reload restores the session without extending its expiration', async () => {
  mock.method(authApi, 'login', async () => session)
  mock.method(userApi, 'info', async () => ({ email: user.email, email_verified: true, expires_at: session.expires_at }))
  await useAuthStore().signIn({ email: user.email, password: 'test-password' })
  const saved = sessionStorage.getItem(SESSION_STORAGE_KEY)
  setActivePinia(createPinia())
  const restored = useAuthStore()
  assert.equal(restored.hasSession(), true)
  assert.equal(restored.sessionToken, session.session_token)
  assert.equal(restored.expiresAt, session.expires_at)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), saved)
})

test('client expiration is capped at twelve hours even for a longer server session', async () => {
  const now = Date.now()
  mock.method(Date, 'now', () => now)
  mock.method(authApi, 'login', async () => ({ ...session, expires_at: new Date(now + 7 * 86400000).toISOString() }))
  mock.method(userApi, 'info', async () => ({ email: user.email, email_verified: true, expires_at: new Date(now + 7 * 86400000).toISOString() }))
  const auth = useAuthStore()
  await auth.signIn({})
  assert.equal(Date.parse(auth.expiresAt), now + 12 * 3600000)
  assert.equal(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)).expiresAt, auth.expiresAt)
})

test('reloading after twelve hours discards the saved login', async () => {
  const now = Date.now()
  mock.method(Date, 'now', () => now)
  mock.method(authApi, 'login', async () => ({ ...session, expires_at: new Date(now + 12 * 3600000).toISOString() }))
  mock.method(userApi, 'info', async () => ({ email: user.email, email_verified: true, expires_at: new Date(now + 12 * 3600000).toISOString() }))
  await useAuthStore().signIn({})
  mock.method(Date, 'now', () => now + 12 * 3600000)
  setActivePinia(createPinia())
  assert.equal(useAuthStore().hasSession(), false)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
})

test('active expired sessions are removed from session storage', async () => {
  mock.method(authApi, 'login', async () => session)
  mock.method(userApi, 'info', async () => ({ email: user.email, email_verified: true, expires_at: session.expires_at }))
  const auth = useAuthStore()
  await auth.signIn({})
  mock.method(Date, 'now', () => Date.parse(session.expires_at))
  assert.equal(auth.hasSession(), false)
  assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
})

test('invalid saved session data is removed', () => {
  for (const value of ['bad-json', 'null', '{}', '[]', JSON.stringify({ user, sessionToken: 'token', expiresAt: 'invalid' })]) {
    sessionStorage.setItem(SESSION_STORAGE_KEY, value)
    setActivePinia(createPinia())
    assert.equal(useAuthStore().isAuthenticated, false)
    assert.equal(sessionStorage.getItem(SESSION_STORAGE_KEY), null)
  }
})

test('missing tab storage does not restore an authenticated session', () => {
  assert.equal(useAuthStore().isAuthenticated, false)
})

test('blocked browser storage does not break login or logout', async () => {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() { throw new Error('Storage is blocked') },
  })
  mock.method(authApi, 'login', async () => session)
  const check = mock.method(userApi, 'info', async () => ({ email: user.email, email_verified: true, expires_at: session.expires_at }))
  mock.method(authApi, 'logout', async () => null)
  const auth = useAuthStore()
  await auth.signIn({})
  assert.equal(auth.hasSession(), true)
  assert.equal(check.mock.callCount(), 0)
  await auth.signOut()
  assert.equal(auth.isAuthenticated, false)
})
