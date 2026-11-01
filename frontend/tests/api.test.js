import { afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { apiRequest, ApiError } from '../src/services/http.js'
import { authApi } from '../src/services/auth.js'
import { appApi } from '../src/services/app.js'
import { sendMessage } from '../src/services/chat.js'
import { cancelRouteRequests } from '../src/services/route-requests.js'

afterEach(() => {
  cancelRouteRequests()
  mock.restoreAll()
})

test('appInfo checks the saved bearer token without caching the result', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ name: 'Clinician' }))
  assert.equal((await appApi.info('saved-token')).name, 'Clinician')
  const [url, options] = fetchMock.mock.calls[0].arguments
  assert.equal(url, '/api/appInfo')
  assert.equal(options.method, 'GET')
  assert.equal(options.headers.Authorization, 'Bearer saved-token')
  assert.equal(options.cache, 'no-store')
})

test('JSON requests include the bearer credential and use the API proxy', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ answer: 'Reference answer.' }))
  const response = await sendMessage('A question', 'test-token')
  assert.equal(response.answer, 'Reference answer.')
  const [url, options] = fetchMock.mock.calls[0].arguments
  assert.equal(url, '/api/chat')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers.Authorization, 'Bearer test-token')
  assert.equal(options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(options.body), { message: 'A question' })
})

test('server validation errors preserve their code, status, and message', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'email_in_use', message: 'Email already exists.' } }, { status: 409 }))
  await assert.rejects(authApi.register({ email: 'test@example.com', password: 'a-test-password' }), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 409)
    assert.equal(error.code, 'email_in_use')
    assert.equal(error.message, 'Email already exists.')
    return true
  })
})

for (const [code, message] of [
  ['weak_password', 'Password is too weak. Use at least 8 characters.'],
  ['invalid_email', 'Enter a valid email address.'],
]) {
  test(`the UI receives the exact server ${code} message`, async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message } }, { status: 400 }))
    await assert.rejects(authApi.register({ email: 'doctor@example.com', password: '12345678' }), (error) => {
      assert.equal(error.status, 400)
      assert.equal(error.code, code)
      assert.equal(error.message, message)
      return true
    })
  })
}

test('logout accepts an empty 204 response', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }))
  assert.equal(await authApi.logout('test-token'), null)
})

test('HTML responses are rejected instead of being mistaken for an API result', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('<html>UI</html>'))
  await assert.rejects(apiRequest('/auth/me'), (error) => error.code === 'invalid_response')
})

test('network failures return a readable error', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(apiRequest('/auth/login'), (error) => error.code === 'network_error' && error.message.includes('Unable to reach'))
})

test('slow requests abort and clear their timeout', async () => {
  mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  await assert.rejects(apiRequest('/chat', { timeout: 5 }), (error) => error.code === 'request_timeout')
})

test('an external cancellation aborts appInfo without reporting a timeout', async () => {
  let requestSignal
  mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    requestSignal = options.signal
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const controller = new AbortController()
  const request = appApi.info('saved-token', { signal: controller.signal })
  controller.abort()
  await assert.rejects(request, (error) => error.code === 'request_cancelled')
  assert.equal(requestSignal.aborted, true)
})

test('a signal canceled before the request skips fetch entirely', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(appApi.info('saved-token', { signal: controller.signal }), (error) => error.code === 'request_cancelled')
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('navigation cancels an outstanding chat request', async () => {
  let requestSignal
  mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    requestSignal = options.signal
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const request = sendMessage('A question', 'saved-token')
  cancelRouteRequests()
  await assert.rejects(request, (error) => error.code === 'request_cancelled')
  assert.equal(requestSignal.aborted, true)
})

test('cancellation while reading a response remains a cancellation error', async () => {
  mock.method(globalThis, 'fetch', async (_url, options) => ({
    status: 200,
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }),
  }))
  const controller = new AbortController()
  const request = appApi.info('saved-token', { signal: controller.signal })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(request, (error) => error.code === 'request_cancelled')
})

test('page navigation does not abort an account operation', async () => {
  let resolveRequest
  let requestSignal
  mock.method(globalThis, 'fetch', (_url, options) => new Promise((resolve) => {
    requestSignal = options.signal
    resolveRequest = resolve
  }))
  const request = authApi.logout('saved-token')
  cancelRouteRequests()
  assert.equal(requestSignal.aborted, false)
  resolveRequest(new Response(null, { status: 204 }))
  await request
})

test('account recovery requests match the backend contracts', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ message: 'ok' }))
  await authApi.login({ email: 'test@example.com', password: 'password' })
  await authApi.verifyEmail('verify-token')
  await authApi.forgotPassword('test@example.com')
  await authApi.resetPassword('reset-token', 'new-password')
  assert.deepEqual(fetchMock.mock.calls.map((call) => call.arguments[0]), [
    '/api/auth/login', '/api/auth/verify-email', '/api/auth/forgot-password', '/api/auth/reset-password',
  ])
  assert.deepEqual(JSON.parse(fetchMock.mock.calls[3].arguments[1].body), { token: 'reset-token', password: 'new-password' })
})
