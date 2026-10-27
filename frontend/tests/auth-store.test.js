import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { authApi } from '../src/services/auth.js'
import { ApiError } from '../src/services/http.js'
import { useAuthStore } from '../src/stores/auth.js'

const user = { id: 'test-user', name: 'Doctor', email: 'doctor@example.com' }
const session = { user, session_token: 'test-token', expires_at: new Date(Date.now() + 3600000).toISOString() }

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => mock.restoreAll())

test('sign in loads the authenticated profile before establishing a session', async () => {
  mock.method(authApi, 'login', async () => session)
  const profile = mock.method(authApi, 'me', async () => ({ user }))
  const auth = useAuthStore()
  await auth.signIn({ email: user.email, password: 'test-password' })
  assert.equal(profile.mock.calls[0].arguments[0], session.session_token)
  assert.equal(auth.user.email, user.email)
  assert.equal(auth.hasSession(), true)
})

test('a profile failure leaves no client session', async () => {
  mock.method(authApi, 'login', async () => session)
  mock.method(authApi, 'me', async () => { throw new ApiError('Unauthorized', 401) })
  const auth = useAuthStore()
  await assert.rejects(auth.signIn({}))
  assert.equal(auth.isAuthenticated, false)
  assert.equal(auth.sessionToken, null)
})

test('sign out revokes the server session and clears client credentials', async () => {
  const revoke = mock.method(authApi, 'logout', async () => null)
  const auth = useAuthStore()
  auth.$patch({ user, sessionToken: session.session_token, expiresAt: session.expires_at })
  await auth.signOut()
  assert.equal(revoke.mock.calls[0].arguments[0], session.session_token)
  assert.equal(auth.isAuthenticated, false)
})

test('an already expired server session can still be signed out locally', async () => {
  mock.method(authApi, 'logout', async () => { throw new ApiError('Expired', 401) })
  const auth = useAuthStore()
  auth.$patch({ user, sessionToken: session.session_token, expiresAt: session.expires_at })
  await auth.signOut()
  assert.equal(auth.sessionToken, null)
})

test('a failed logout preserves the session for a retry', async () => {
  mock.method(authApi, 'logout', async () => { throw new ApiError('Unavailable', 503) })
  const auth = useAuthStore()
  auth.$patch({ user, sessionToken: session.session_token, expiresAt: session.expires_at })
  await assert.rejects(auth.signOut())
  assert.equal(auth.isAuthenticated, true)
})

test('expired credentials cannot pass the client route guard', () => {
  const auth = useAuthStore()
  auth.$patch({ user, sessionToken: session.session_token, expiresAt: '2020-01-01T00:00:00Z' })
  assert.equal(auth.hasSession(), false)
  assert.equal(auth.user, null)
})
