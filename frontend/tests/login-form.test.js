import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useLoginForm } from '../src/composables/useLoginForm.js'
import { LOGIN_MESSAGES, useAuthStore } from '../src/stores/auth.js'
import { useNotificationsStore } from '../src/stores/notifications.js'
import { authApi } from '../src/services/auth.js'
import { ApiError } from '../src/services/http.js'

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
afterEach(() => {
  mock.restoreAll()
  mock.timers.reset()
})

async function mountLogin(context, location = '/login', loginReason = '') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().loginReason = loginReason
  const notifications = useNotificationsStore()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: {} },
      { path: '/home', name: 'home', component: {}, meta: { requiresAuth: true } },
      { path: '/chat', name: 'chat', component: {}, meta: { requiresAuth: true } },
    ],
  })
  await router.push(location)
  let state
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {} })
  const app = renderer.createApp({
    setup() {
      state = useLoginForm()
      return () => null
    },
  })
  app.use(pinia).use(router).mount({})
  context.after(() => {
    app.unmount()
    notifications.$dispose()
  })
  return { ...state, router, notifications }
}

test('invalid login input focuses the first invalid field and shows its error in the popup', async (context) => {
  const login = mock.method(authApi, 'login', async () => {})
  const state = await mountLogin(context)
  let focused
  state.form.value = { elements: { namedItem: (field) => ({ focus: () => { focused = field } }) } }
  await state.submit()
  assert.equal(focused, 'email')
  assert.deepEqual(state.notifications.notification, { type: 'error', message: 'Enter your email address.' })
  assert.equal(state.fieldError('email'), 'Enter your email address.')
  state.email.value = 'doctor@example.com'
  await state.submit()
  assert.equal(focused, 'password')
  assert.equal(state.notifications.notification.message, 'Enter your password.')
  assert.equal(login.mock.callCount(), 0)
})

test('registration password mismatches use the popup and prevent the request', async (context) => {
  const register = mock.method(authApi, 'register', async () => {})
  const state = await mountLogin(context, '/login?mode=register')
  state.email.value = 'doctor@example.com'
  state.password.value = 'a-long-password'
  state.confirmPassword.value = 'different-password'
  await state.submit()
  assert.deepEqual(state.notifications.notification, { type: 'error', message: 'Passwords do not match.' })
  assert.equal(register.mock.callCount(), 0)
})

for (const [operation, status, code, message] of [
  ['login', 401, 'invalid_credentials', 'Invalid email or password.'],
  ['register', 400, 'weak_password', 'Password is too weak. Use at least 8 characters.'],
  ['register', 409, 'email_in_use', 'An account with this email already exists.'],
]) {
  test(`${code} appears in the global popup with the exact server message`, async (context) => {
    mock.method(authApi, operation, async () => { throw new ApiError(message, status, code) })
    const state = await mountLogin(context, operation === 'register' ? '/login?mode=register' : '/login')
    state.email.value = 'doctor@example.com'
    state.password.value = 'a-long-password'
    state.confirmPassword.value = 'a-long-password'
    await state.submit()
    assert.deepEqual(state.notifications.notification, { type: 'error', message })
    assert.equal(state.email.value, 'doctor@example.com')
    assert.equal(state.password.value, '')
    assert.equal(state.confirmPassword.value, '')
    assert.equal(state.pending.value, false)
    assert.equal(state.router.currentRoute.value.name, 'login')
  })
}

for (const [location, reason, expected] of [
  ['/login', 'expired', LOGIN_MESSAGES.expired],
  ['/login?reason=denied', '', LOGIN_MESSAGES.denied],
  ['/login?expired=1', '', LOGIN_MESSAGES.expired],
]) {
  test(`session notice for ${location} ${reason} appears once and expires`, async (context) => {
    const state = await mountLogin(context, location, reason)
    assert.deepEqual(state.notifications.notification, { type: 'error', message: expected })
    mock.timers.tick(3000)
    assert.equal(state.notifications.notification, null)
    state.email.value = 'doctor@example.com'
    await nextTick()
    assert.equal(state.notifications.notification, null)
  })
}

test('a normal login page visit does not display an error', async (context) => {
  const state = await mountLogin(context)
  assert.equal(state.notifications.notification, null)
})

test('switching to registration clears the popup and password fields while preserving the return destination', async (context) => {
  const state = await mountLogin(context, '/login?reason=expired&redirect=%2Fchat')
  state.password.value = 'a-long-password'
  state.showPassword.value = true
  await state.setMode(true)
  assert.equal(state.notifications.notification, null)
  assert.equal(state.password.value, '')
  assert.equal(state.showPassword.value, false)
  assert.deepEqual(state.router.currentRoute.value.query, { mode: 'register', redirect: '/chat' })
})

test('successful registration keeps verification instructions and switches back to sign in', async (context) => {
  const register = mock.method(authApi, 'register', async () => ({}))
  const state = await mountLogin(context, '/login?mode=register')
  state.email.value = 'doctor@example.com'
  state.password.value = 'a-long-password'
  state.confirmPassword.value = 'a-long-password'
  await state.submit()
  assert.deepEqual(register.mock.calls[0].arguments[0], { email: 'doctor@example.com', password: 'a-long-password' })
  assert.equal(state.isRegister.value, false)
  assert.match(state.success.value, /We sent a verification link to doctor@example.com/)
  assert.equal(state.notifications.notification, null)
})

test('successful login still follows a protected return destination', async (context) => {
  mock.method(authApi, 'login', async () => ({
    user: { email: 'doctor@example.com' }, session_token: 'signed-jwt',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  }))
  const state = await mountLogin(context, '/login?redirect=%2Fchat%3Fview%3Drecent%23latest')
  state.email.value = 'doctor@example.com'
  state.password.value = 'a-long-password'
  await state.submit()
  assert.equal(state.router.currentRoute.value.fullPath, '/chat?view=recent#latest')
  assert.equal(state.notifications.notification, null)
})
