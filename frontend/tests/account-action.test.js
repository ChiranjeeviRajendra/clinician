import { afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { useAccountAction } from '../src/composables/useAccountAction.js'
import { authApi } from '../src/services/auth.js'
import { mountComposable } from './helpers/mount.js'

afterEach(() => mock.restoreAll())

function mountAction(context, location) {
  return mountComposable(context, useAccountAction, {
    location,
    routes: ['verify-email', 'forgot-password', 'reset-password'].map((name) => ({
      path: `/${name}`,
      name,
      component: {},
    })),
  })
}

test('verification retains the token in memory after removing it from the address bar', async (context) => {
  const verify = mock.method(authApi, 'verifyEmail', async () => ({ message: 'Verified.' }))
  const { state, router } = await mountAction(context, '/verify-email#token=secret-token')
  assert.equal(router.currentRoute.value.hash, '')
  assert.equal(state.token.value, 'secret-token')
  assert.equal(verify.mock.callCount(), 0)
  await state.submit()
  assert.deepEqual(verify.mock.calls[0].arguments, ['secret-token'])
  assert.equal(state.success.value, 'Verified.')
  assert.equal(state.token.value, '')
})

test('password reset validates confirmation before sending credentials', async (context) => {
  const reset = mock.method(authApi, 'resetPassword', async () => ({ message: 'Reset.' }))
  const { state } = await mountAction(context, '/reset-password#token=reset-token')
  state.password.value = 'long-password'
  state.confirmPassword.value = 'different-password'
  await state.submit()
  assert.equal(reset.mock.callCount(), 0)
  assert.equal(state.fieldError('confirmPassword'), 'Passwords do not match.')
  state.confirmPassword.value = 'long-password'
  await state.submit()
  assert.deepEqual(reset.mock.calls[0].arguments, ['reset-token', 'long-password'])
  assert.equal(state.password.value, '')
  assert.equal(state.confirmPassword.value, '')
})

test('failed resets retain the token for retry and clear password fields', async (context) => {
  mock.method(authApi, 'resetPassword', async () => {
    throw new Error('Try again.')
  })
  const { state } = await mountAction(context, '/reset-password#token=reset-token')
  state.password.value = state.confirmPassword.value = 'long-password'
  await state.submit()
  assert.equal(state.error.value, 'Try again.')
  assert.equal(state.token.value, 'reset-token')
  assert.equal(state.password.value, '')
  assert.equal(state.confirmPassword.value, '')
  assert.equal(state.pending.value, false)
})

test('password recovery trims email and prevents duplicate submissions', async (context) => {
  let finish
  const recover = mock.method(
    authApi,
    'forgotPassword',
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { state } = await mountAction(context, '/forgot-password')
  state.email.value = ' doctor@example.com '
  const submission = state.submit()
  await state.submit()
  assert.equal(recover.mock.callCount(), 1)
  assert.deepEqual(recover.mock.calls[0].arguments, ['doctor@example.com'])
  finish({ message: 'Check your email.' })
  await submission
  assert.equal(state.success.value, 'Check your email.')
  assert.equal(state.pending.value, false)
})
