const fields = ['full_name', 'age', 'gender', 'height_cm', 'weight_kg', 'ethnicity']
const numericFields = new Set(['age', 'gender', 'height_cm', 'weight_kg', 'ethnicity'])

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
