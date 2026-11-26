import { afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat } from '../src/composables/useChat.js'
import { useAuthStore } from '../src/stores/auth.js'
import { cancelRouteRequests } from '../src/services/route-requests.js'
import { flushPromises, mountComposable } from './helpers/mount.js'

afterEach(() => {
  cancelRouteRequests()
  mock.restoreAll()
})

function mountChat(context) {
  return mountComposable(context, useChat, {
    location: '/chat',
    routes: [
      { path: '/chat', name: 'chat', component: {} },
      { path: '/login', name: 'login', component: {} },
    ],
    configure: () =>
      useAuthStore().$patch({
        user: { email: 'doctor@example.com' },
        sessionToken: 'signed-jwt',
        fullName: 'Asha',
      }),
  })
}

test('chat sends a trimmed question and displays both messages', async (context) => {
  const request = mock.method(globalThis, 'fetch', async () =>
    Response.json({ answer: 'A reference answer.' }),
  )
  const { state } = await mountChat(context)
  state.draft.value = '  A question?  '
  await state.submit()
  assert.deepEqual(
    state.messages.value.map(({ role, content }) => ({ role, content })),
    [
      { role: 'user', content: 'A question?' },
      { role: 'assistant', content: 'A reference answer.' },
    ],
  )
  const [url, options] = request.mock.calls[0].arguments
  assert.equal(url, '/api/chat')
  assert.equal(options.headers.Authorization, 'Bearer signed-jwt')
  assert.deepEqual(JSON.parse(options.body), { message: 'A question?' })
  assert.equal(state.draft.value, '')
  assert.equal(state.userInitial.value, 'A')
  assert.equal(state.pending.value, false)
})

test('retry preserves the original question without duplicating its message', async (context) => {
  const request = mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {
        error: { message: 'Try again later.', code: 'assistant_unavailable' },
      },
      { status: 503 },
    ),
  )
  const { state } = await mountChat(context)
  await state.submit('A question?')
  assert.equal(state.error.value, 'Try again later.')
  request.mock.mockImplementation(async () => Response.json({ answer: 'Recovered.' }))
  await state.retry()
  assert.equal(state.messages.value.length, 2)
  assert.equal(state.messages.value[1].content, 'Recovered.')
  assert.equal(state.error.value, '')
  state.newConversation()
  assert.deepEqual(state.messages.value, [])
  assert.equal(state.conversationTitle.value, 'Your first conversation')
})

test('pending questions cannot be submitted twice or cleared mid-response', async (context) => {
  let finish
  const request = mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { state } = await mountChat(context)
  const submission = state.submit('First question')
  await flushPromises()
  await state.submit('Second question')
  state.newConversation()
  assert.equal(request.mock.callCount(), 1)
  assert.equal(state.messages.value[0].content, 'First question')
  finish(Response.json({ answer: 'Answer' }))
  await submission
  assert.equal(state.pending.value, false)
})

test('unmount cancels a chat request and ignores its late response', async (context) => {
  let finish
  const request = mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { state, unmount } = await mountChat(context)
  const submission = state.submit('A question')
  await flushPromises()
  unmount()
  assert.equal(request.mock.calls[0].arguments[1].signal.aborted, true)
  finish(Response.json({ answer: 'Too late' }))
  await submission
  assert.equal(state.messages.value.length, 1)
  assert.equal(state.error.value, '')
})

test('expired chat sessions redirect to login with the return destination', async (context) => {
  mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {
        error: { code: 'session_expired', message: 'Expired' },
      },
      { status: 401 },
    ),
  )
  const { state, router } = await mountChat(context)
  await state.submit('A question')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.reason, 'expired')
  assert.equal(router.currentRoute.value.query.redirect, '/chat')
  assert.equal(useAuthStore().sessionToken, null)
})

for (const response of [null, {}, { answer: 42 }]) {
  test(`malformed chat answer ${JSON.stringify(response)} leaves a retryable error`, async (context) => {
    mock.method(globalThis, 'fetch', async () => Response.json(response))
    const { state } = await mountChat(context)
    await state.submit('A question')
    assert.match(state.error.value, /unexpected response/)
    assert.equal(state.messages.value.length, 1)
    assert.equal(state.pending.value, false)
  })
}
