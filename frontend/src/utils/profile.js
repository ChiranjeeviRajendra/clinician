const fields = ['full_name', 'date_of_birth', 'gender', 'height_cm', 'weight_kg', 'ethnicity']
const numericFields = new Set(['gender', 'height_cm', 'weight_kg', 'ethnicity'])

export function formatDateOfBirth(value, locale) {
  if (!value) return 'Not added'
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'Not added'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(date)
}

export const PROFILE_GENDERS = Object.freeze([
  { id: 1, name: 'Male' },
  { id: 2, name: 'Female' },
])

export function genderLabel(id) {
  return PROFILE_GENDERS.find((gender) => gender.id === id)?.name ?? 'Not added'
}

export function profileForm(profile) {
  return Object.fromEntries(fields.map((field) => [field, profile[field] ?? '']))
}

export function profileChanges(form, profile) {
  // Send only edits so a progressive save preserves the other saved details.
  return Object.fromEntries(fields.flatMap((field) => {
    const input = typeof form[field] === 'string' ? form[field].trim() : form[field]
    const value = input === '' || input == null ? null : numericFields.has(field) ? Number(input) : input
    return value === (profile[field] ?? null) ? [] : [[field, value]]
  }))
}
