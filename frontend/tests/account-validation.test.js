import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref } from 'vue'
import { useAccountValidation, validateAccountFields } from '../src/composables/useAccountValidation.js'

const valid = { email: 'doctor@example.com', password: 'a-long-password', confirmPassword: 'a-long-password' }

test('registration requires an email, a password, and confirmation', () => {
  assert.deepEqual(Object.keys(validateAccountFields({}, 'register')), ['email', 'password', 'confirmPassword'])
})

test('valid matching registration passwords pass, including surrounding whitespace in email', () => {
  assert.deepEqual(validateAccountFields({ ...valid, email: ' doctor@example.com ' }, 'register'), {})
})

test('malformed and oversized emails cannot be submitted', () => {
  for (const email of [' ', 'doctor', 'doctor@', '@example.com', 'doctor@@example.com', 'doctor name@example.com', 'doctor@example', 'x'.repeat(243) + '@example.com']) {
    assert.ok(validateAccountFields({ ...valid, email }, 'register').email)
  }
})

test('new passwords must contain 12 to 128 characters', () => {
  for (const length of [11, 129]) {
    assert.ok(validateAccountFields({ ...valid, password: 'x'.repeat(length), confirmPassword: 'x'.repeat(length) }, 'register').password)
  }
  for (const length of [12, 128]) {
    assert.deepEqual(validateAccountFields({ ...valid, password: 'x'.repeat(length), confirmPassword: 'x'.repeat(length) }, 'register'), {})
  }
})

test('password length follows Unicode character counts used by the backend', () => {
  assert.ok(validateAccountFields({ ...valid, password: '😀'.repeat(6), confirmPassword: '😀'.repeat(6) }, 'register').password)
  assert.deepEqual(validateAccountFields({ ...valid, password: '😀'.repeat(12), confirmPassword: '😀'.repeat(12) }, 'register'), {})
})

test('confirmation must match exactly, without trimming or changing case', () => {
  for (const confirmPassword of ['', 'a-long-password ', 'A-long-password', 'a-different-password']) {
    assert.ok(validateAccountFields({ ...valid, confirmPassword }, 'register').confirmPassword)
    assert.ok(validateAccountFields({ ...valid, confirmPassword }, 'reset').confirmPassword)
  }
})

test('login needs a password but does not impose registration rules or confirmation', () => {
  assert.deepEqual(validateAccountFields({ email: valid.email, password: 'short' }, 'login'), {})
  assert.ok(validateAccountFields({ email: valid.email }, 'login').password)
  assert.ok(validateAccountFields({ email: valid.email, password: 'x'.repeat(129) }, 'login').password)
})

test('password reset requires matching new passwords without asking for an email', () => {
  assert.deepEqual(validateAccountFields({ password: valid.password, confirmPassword: valid.confirmPassword }, 'reset'), {})
  assert.ok(validateAccountFields({ password: valid.password }, 'reset').confirmPassword)
})

test('recovery validates only email and verification needs neither email nor passwords', () => {
  assert.deepEqual(validateAccountFields({ email: valid.email }, 'forgot'), {})
  assert.ok(validateAccountFields({}, 'forgot').email)
  assert.deepEqual(validateAccountFields({}, 'verify'), {})
})

test('validation shows field errors on blur or submit, focuses the first invalid field, and updates while typing', () => {
  const fields = ref({ email: '', password: '', confirmPassword: '' })
  const validation = useAccountValidation(() => fields.value, () => 'register')
  let focused
  validation.form.value = { elements: { namedItem: (field) => ({ focus: () => { focused = field } }) } }
  assert.equal(validation.fieldError('email'), '')
  validation.touch('email')
  assert.ok(validation.fieldError('email'))
  assert.equal(validation.fieldError('password'), '')
  assert.equal(validation.validate(), false)
  assert.equal(focused, 'email')
  assert.ok(validation.fieldError('password'))
  fields.value = { ...valid, confirmPassword: 'mismatched-password' }
  assert.equal(validation.fieldError('email'), '')
  assert.equal(validation.fieldError('password'), '')
  assert.equal(validation.fieldError('confirmPassword'), 'Passwords do not match.')
  fields.value.confirmPassword = valid.password
  assert.equal(validation.fieldError('confirmPassword'), '')
  assert.equal(validation.validate(), true)
  fields.value.password = 'changed-password'
  assert.equal(validation.fieldError('confirmPassword'), 'Passwords do not match.')
  validation.resetValidation()
  assert.equal(validation.fieldError('confirmPassword'), '')
})
