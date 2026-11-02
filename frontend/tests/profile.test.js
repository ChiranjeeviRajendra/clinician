import { afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers'
import { createRenderer } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useUserProfile } from '../src/composables/useUserProfile.js'
import { useProfileEditor } from '../src/composables/useProfileEditor.js'
import { useAuthStore } from '../src/stores/auth.js'
import { useNotificationsStore } from '../src/stores/notifications.js'
import { profileApi } from '../src/services/profile.js'
import { ApiError } from '../src/services/http.js'
import { cancelRouteRequests } from '../src/services/route-requests.js'
import { PROFILE_GENDERS, formatDateOfBirth, genderLabel, profileChanges, profileForm } from '../src/utils/profile.js'

const profile = {
  id: 'current-user', full_name: 'Asha Patel', date_of_birth: '1996-01-15', gender: 2,
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

async function mountProfile(context, options, setup) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().$patch({ user: { email: 'doctor@example.com' }, sessionToken: 'signed-jwt' })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/profile', name: 'profile', component: {} },
      { path: '/update-profile', name: 'update-profile', component: {} },
    ],
  })
  await router.push(setup ? '/update-profile' : '/profile')
  let state
  // A comment-only component exercises lifecycle hooks without a browser or database.
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {} })
  const app = renderer.createApp({
    setup() {
      state = setup ? setup() : useUserProfile(options)
      return () => null
    },
  })
  app.use(pinia).use(router).mount({})
  context.after(() => {
    app.unmount()
    useNotificationsStore(pinia).$dispose()
  })
  await new Promise((resolve) => setImmediate(resolve))
  return { ...state, router }
}

test('saving a completed profile navigates to profile and shows the global success message', async (context) => {
  mock.method(profileApi, 'getUserProfile', async () => ({ profile }))
  mock.method(profileApi, 'getEthnicities', async () => ({ ethnicities: [] }))
  const update = mock.method(profileApi, 'updateUserProfile', async () => ({ profile: { ...profile, full_name: 'Asha Rao' } }))
  const state = await mountProfile(context, undefined, useProfileEditor)
  state.form.full_name = 'Asha Rao'
  await state.submit()
  assert.deepEqual(update.mock.calls[0].arguments[0], { full_name: 'Asha Rao' })
  assert.equal(state.router.currentRoute.value.name, 'profile')
  assert.deepEqual(useNotificationsStore().notification, { type: 'success', message: 'Profile saved. Your profile is complete.' })
  assert.equal(state.pending.value, false)
})

test('saving a partial profile returns to profile with a confirmation that more details can be added', async (context) => {
  mock.method(profileApi, 'getUserProfile', async () => ({ profile }))
  mock.method(profileApi, 'getEthnicities', async () => ({ ethnicities: [] }))
  mock.method(profileApi, 'updateUserProfile', async () => ({ profile: { ...profile, date_of_birth: null, isProfileCompleted: false } }))
  const state = await mountProfile(context, undefined, useProfileEditor)
  state.form.date_of_birth = ''
  await state.submit()
  assert.equal(state.router.currentRoute.value.name, 'profile')
  assert.equal(useNotificationsStore().notification.message, 'Profile saved. You can add more details anytime.')
})

test('a failed profile save stays on the form and shows an error popup without losing edits', async (context) => {
  mock.method(profileApi, 'getUserProfile', async () => ({ profile }))
  mock.method(profileApi, 'getEthnicities', async () => ({ ethnicities: [] }))
  mock.method(profileApi, 'updateUserProfile', async () => { throw new ApiError('Unable to save your profile.', 503) })
  const state = await mountProfile(context, undefined, useProfileEditor)
  state.form.full_name = 'Unsaved name'
  await state.submit()
  assert.equal(state.router.currentRoute.value.name, 'update-profile')
  assert.equal(state.form.full_name, 'Unsaved name')
  assert.deepEqual(useNotificationsStore().notification, { type: 'error', message: 'Unable to save your profile.' })
  assert.equal(state.pending.value, false)
})

test('the form prevents repeated saves during navigation and starts the notification after arrival', async (context) => {
  mock.method(profileApi, 'getUserProfile', async () => ({ profile }))
  mock.method(profileApi, 'getEthnicities', async () => ({ ethnicities: [] }))
  const update = mock.method(profileApi, 'updateUserProfile', async () => ({ profile }))
  const state = await mountProfile(context, undefined, useProfileEditor)
  let finishNavigation
  state.router.beforeEach(() => new Promise((resolve) => { finishNavigation = resolve }))
  const submission = state.submit()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.pending.value, true)
  assert.equal(useNotificationsStore().notification, null)
  await state.submit()
  assert.equal(update.mock.callCount(), 1)
  finishNavigation(true)
  await submission
  assert.equal(state.router.currentRoute.value.name, 'profile')
  assert.equal(state.pending.value, false)
  assert.equal(useNotificationsStore().notification.type, 'success')
})

test('the profile summary loads user information without requesting dropdown choices', async (context) => {
  const details = mock.method(profileApi, 'getUserProfile', async () => ({ profile }))
  const ethnicities = mock.method(profileApi, 'getEthnicities', async () => ({ ethnicities: [] }))
  const state = await mountProfile(context)
  assert.deepEqual(state.profile.value, profile)
  assert.equal(state.loading.value, false)
  assert.equal(details.mock.calls[0].arguments[0], 'signed-jwt')
  assert.equal(ethnicities.mock.callCount(), 0)
  assert.equal(useAuthStore().displayName, 'Asha Patel')
})

test('saving or clearing the full name updates the shared account display immediately', async (context) => {
  mock.method(profileApi, 'getUserProfile', async () => ({ profile }))
  const state = await mountProfile(context)
  const update = mock.method(profileApi, 'updateUserProfile', async () => ({ profile: { ...profile, full_name: 'Asha Rao' } }))
  assert.equal(await state.save({ full_name: 'Asha Rao' }), true)
  assert.equal(useAuthStore().displayName, 'Asha Rao')
  update.mock.mockImplementation(async () => ({ profile: { ...profile, full_name: null } }))
  assert.equal(await state.save({ full_name: null }), true)
  assert.equal(useAuthStore().displayName, 'doctor@example.com')
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
  await profileApi.updateUserProfile({ date_of_birth: '1995-02-20', ethnicity: null }, 'signed-jwt')
  const [url, options] = request.mock.calls[0].arguments
  assert.equal(url, '/api/updateUserProfile')
  assert.equal(options.method, 'PATCH')
  assert.equal(options.headers.Authorization, 'Bearer signed-jwt')
  assert.deepEqual(JSON.parse(options.body), { date_of_birth: '1995-02-20', ethnicity: null })
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
  form.date_of_birth = ''
  form.height_cm = ''
  form.ethnicity = ''
  assert.deepEqual(profileChanges(form, profile), { full_name: null, date_of_birth: null, height_cm: null, ethnicity: null })
})

test('measurements stay numeric while birth dates remain date-only strings', () => {
  const form = profileForm(profile)
  Object.assign(form, { date_of_birth: '2000-02-29', height_cm: '170.25', weight_kg: '66.75' })
  assert.deepEqual(profileChanges(form, profile), { date_of_birth: '2000-02-29', weight_kg: 66.75 })
  assert.equal(profileForm({ date_of_birth: null }).date_of_birth, '')
})

test('birth dates display as calendar dates without a timezone shift', () => {
  assert.equal(formatDateOfBirth('2000-02-29', 'en-US'), 'February 29, 2000')
  assert.equal(formatDateOfBirth('1996-01-01', 'en-GB'), '1 January 1996')
  assert.equal(formatDateOfBirth(null), 'Not added')
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
