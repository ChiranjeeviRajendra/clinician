import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useNotificationsStore } from '../src/stores/notifications.js'

beforeEach(() => {
  setActivePinia(createPinia())
  mock.timers.enable({ apis: ['setTimeout'] })
})

afterEach(() => {
  useNotificationsStore().$dispose()
  mock.timers.reset()
})

for (const type of ['success', 'warning', 'error']) {
  test(`${type} notifications disappear after exactly three seconds`, () => {
    const notifications = useNotificationsStore()
    notifications[type]('A useful message')
    assert.deepEqual(notifications.notification, { message: 'A useful message', type })
    mock.timers.tick(2999)
    assert.equal(notifications.notification.message, 'A useful message')
    mock.timers.tick(1)
    assert.equal(notifications.notification, null)
  })
}

test('a newer message gets a fresh three seconds without being dismissed by the previous timer', () => {
  const notifications = useNotificationsStore()
  notifications.error('First message')
  mock.timers.tick(2000)
  notifications.success('Latest message')
  mock.timers.tick(1000)
  assert.equal(notifications.notification.message, 'Latest message')
  mock.timers.tick(1999)
  assert.equal(notifications.notification.message, 'Latest message')
  mock.timers.tick(1)
  assert.equal(notifications.notification, null)
})

test('notifications can be dismissed early and then shown again', () => {
  const notifications = useNotificationsStore()
  notifications.warning('Check this')
  mock.timers.tick(1000)
  notifications.dismiss()
  assert.equal(notifications.notification, null)
  notifications.success('Saved')
  mock.timers.tick(2000)
  assert.equal(notifications.notification.message, 'Saved')
  mock.timers.tick(1000)
  assert.equal(notifications.notification, null)
})
