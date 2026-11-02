import { computed, ref } from 'vue'

export function validateAccountFields({ email = '', password = '', confirmPassword = '' }, mode) {
  const errors = {}
  if (mode === 'verify') return errors
  if (mode !== 'reset') {
    const address = email.trim()
    if (!address) errors.email = 'Enter your email address.'
    else if (Array.from(address).length > 254) errors.email = 'Email must contain no more than 254 characters.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) errors.email = 'Enter a valid email address.'
  }
  if (mode !== 'forgot') {
    const minimum = mode === 'login' ? 1 : 8
    const length = Array.from(password).length
    if (!length) errors.password = 'Enter your password.'
    else if (length < minimum || length > 128) {
      errors.password = `Password must contain ${minimum}\u2013128 characters.`
    }
  }
  if (mode === 'register' || mode === 'reset') {
    if (!confirmPassword) errors.confirmPassword = 'Confirm your password.'
    else if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.'
  }
  return errors
}

export function useAccountValidation(fields, mode) {
  const form = ref(null)
  const touched = ref({})
  const submitted = ref(false)
  const errors = computed(() => validateAccountFields(fields(), mode()))

  function fieldError(field) {
    return touched.value[field] || submitted.value ? errors.value[field] || '' : ''
  }

  function touch(field) {
    touched.value[field] = true
  }

  function validate(onInvalid) {
    submitted.value = true
    const firstInvalid = Object.keys(errors.value)[0]
    if (firstInvalid) {
      form.value?.elements.namedItem(firstInvalid)?.focus()
      onInvalid?.(errors.value[firstInvalid])
    }
    return !firstInvalid
  }

  function resetValidation() {
    touched.value = {}
    submitted.value = false
  }

  return { form, fieldError, touch, validate, resetValidation }
}
