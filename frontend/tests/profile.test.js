import { afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers'
import { createRenderer } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useUserProfile } from '../src/composables/useUserProfile.js'
import { useAuthStore } from '../src/stores/auth.js'
import { profileApi } from '../src/services/profile.js'
import { cancelRouteRequests } from '../src/services/route-requests.js'
import { PROFILE_GENDERS, genderLabel, profileChanges, profileForm } from '../src/utils/profile.js'

const profile = {
  id: 'current-user', full_name: 'Asha Patel', age: 30, gender: 2,
  height_cm: 170.25, weight_kg: 65.5, ethnicity: 11, ethnicity_name: 'South Asian', isProfileCompleted: true,
}

afterEach(() => {
  cancelRouteRequests()
  mock.restoreAll()
})

test('profile fetch sends the session token and reads only user information', async () => {
  const response = { profile }
  const request = mock.method(globalThis, 'fetch', async () => Response.json(response))
  assert.deepEqual(await profileApi.getUserProfile('signed-jwt'), response)
  const [url, options] = request.mock.calls[0].arguments
  assert.equal(url, '/api/getUserProfile')
  assert.equal(options.method, 'GET')
  assert.equal(options.headers.Authorization, 'Bearer signed-jwt')
  assert.equal(options.cache, 'no-store')
})

for (const [method, key, choices] of [
  ['getEthnicities', 'ethnicities', [{ id: 11, name: 'South Asian' }, { id: 16, name: 'Prefer not to say' }]],
]) {
  test(`${method} fetches dropdown choices from its dedicated endpoint`, async () => {
    const response = { [key]: choices }
    const request = mock.method(globalThis, 'fetch', async () => Response.json(response))
    assert.deepEqual(await profileApi[method]('signed-jwt'), response)
    const [url, options] = request.mock.calls[0].arguments
    assert.equal(url, `/api/${method}`)
    assert.equal(options.method, 'GET')
    assert.equal(options.headers.Authorization, 'Bearer signed-jwt')
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(profileApi[method]('jwt', { signal: controller.signal }), (error) => error.code === 'request_cancelled')
    assert.equal(request.mock.callCount(), 1)
  })
}

async function mountProfile(context, options) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().sessionToken = 'signed-jwt'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/profile', component: {} }],
  })
  await router.push('/profile')
  let state
  // A comment-only component exercises lifecycle hooks without a browser or database.
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {} })
  const app = renderer.createApp({
    setup() {
      state = useUserProfile(options)
      return () => null
    },
  })
  app.use(pinia).use(router).mount({})
  context.after(() => app.unmount())
  await new Promise((resolve) => setImmediate(resolve))
  return state
}

test('the profile summary loads user information without requesting dropdown choices', async (context) => {
  const details = mock.method(profileApi, 'getUserProfile', async () => ({ profile }))
  const ethnicities = mock.method(profileApi, 'getEthnicities', async () => ({ ethnicities: [] }))
  const state = await mountProfile(context)
  assert.deepEqual(state.profile.value, profile)
  assert.equal(state.loading.value, false)
  assert.equal(details.mock.calls[0].arguments[0], 'signed-jwt')
  assert.equal(ethnicities.mock.callCount(), 0)
})

test('the update form waits for the ethnicity request before displaying saved details', async (context) => {
  let finishEthnicities
  mock.method(profileApi, 'getUserProfile', async () => ({ profile }))
  mock.method(profileApi, 'getEthnicities', () => new Promise((resolve) => { finishEthnicities = resolve }))
  const state = await mountProfile(context, { includeOptions: true })
  assert.equal(state.loading.value, true)
  assert.equal(state.profile.value, null)
  finishEthnicities({ ethnicities: [{ id: 11, name: 'South Asian' }] })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.loading.value, false)
  assert.deepEqual(state.profile.value, profile)
  assert.deepEqual(state.options.value, { ethnicities: [{ id: 11, name: 'South Asian' }] })
})

test('a failed dropdown request leaves the form unloaded and can be retried', async (context) => {
  mock.method(profileApi, 'getUserProfile', async () => ({ profile }))
  const ethnicities = mock.method(profileApi, 'getEthnicities', async () => { throw new Error('Choices unavailable') })
  const state = await mountProfile(context, { includeOptions: true })
  assert.equal(state.profile.value, null)
  assert.equal(state.loading.value, false)
  assert.equal(state.error.value, 'Choices unavailable')
  ethnicities.mock.mockImplementation(async () => ({ ethnicities: [{ id: 11, name: 'South Asian' }] }))
  await state.load()
  assert.equal(state.error.value, '')
  assert.deepEqual(state.profile.value, profile)
  assert.deepEqual(state.options.value, { ethnicities: [{ id: 11, name: 'South Asian' }] })
})

test('gender choices are defined in the UI with numeric IDs and readable labels', () => {
  assert.deepEqual(PROFILE_GENDERS, [{ id: 1, name: 'Male' }, { id: 2, name: 'Female' }])
  assert.equal(genderLabel(1), 'Male')
  assert.equal(genderLabel(2), 'Female')
  assert.equal(genderLabel(null), 'Not added')
})

test('dropdown selections save multi-digit numeric IDs and omit unchanged saved selections', () => {
  const form = profileForm(profile)
  form.gender = '1'
  form.ethnicity = '16'
  assert.deepEqual(profileChanges(form, profile), { gender: 1, ethnicity: 16 })
  form.gender = '2'
  form.ethnicity = '11'
  assert.deepEqual(profileChanges(form, profile), {})
})

test('partial profile updates use PATCH and preserve explicit clearing', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ profile }))
  await profileApi.updateUserProfile({ age: 31, ethnicity: null }, 'signed-jwt')
  const [url, options] = request.mock.calls[0].arguments
  assert.equal(url, '/api/updateUserProfile')
  assert.equal(options.method, 'PATCH')
  assert.equal(options.headers.Authorization, 'Bearer signed-jwt')
  assert.deepEqual(JSON.parse(options.body), { age: 31, ethnicity: null })
})

test('opening and saving a profile unchanged sends no field edits', () => {
  assert.deepEqual(profileChanges(profileForm(profile), profile), {})
  const blank = { id: 'current-user', isProfileCompleted: false }
  assert.deepEqual(profileChanges(profileForm(blank), blank), {})
})

test('editing one field preserves all other saved fields and strips surrounding whitespace', () => {
  const form = profileForm(profile)
  form.full_name = '  Asha Rao  '
  assert.deepEqual(profileChanges(form, profile), { full_name: 'Asha Rao' })
})

test('clearing optional details sends null and does not send identity or completion', () => {
  const form = profileForm(profile)
  form.full_name = '   '
  form.height_cm = ''
  form.ethnicity = ''
  assert.deepEqual(profileChanges(form, profile), { full_name: null, height_cm: null, ethnicity: null })
})

test('measurements stay numeric in cm and kg, and zero age is retained', () => {
  const form = profileForm(profile)
  Object.assign(form, { age: '0', height_cm: '170.25', weight_kg: '66.75' })
  assert.deepEqual(profileChanges(form, profile), { age: 0, weight_kg: 66.75 })
  assert.equal(profileForm({ age: 0 }).age, 0)
})

test('profile updates show backend validation errors and can be cancelled on navigation', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'invalid_input', message: 'Choose a listed ethnicity or leave it blank.' } }, { status: 400 }))
  await assert.rejects(profileApi.updateUserProfile({ ethnicity: 'invalid' }, 'jwt'), (error) => {
    assert.equal(error.status, 400)
    assert.equal(error.message, 'Choose a listed ethnicity or leave it blank.')
    return true
  })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(profileApi.getUserProfile('jwt', { signal: controller.signal }), (error) => error.code === 'request_cancelled')
})
