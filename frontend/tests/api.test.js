import { afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { apiRequest, ApiError } from '../src/services/http.js'
import { authApi } from '../src/services/auth.js'
import { sendMessage } from '../src/services/chat.js'

afterEach(() => mock.restoreAll())

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
