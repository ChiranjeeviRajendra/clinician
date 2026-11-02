<template>
  <section class="profile-page" aria-labelledby="update-profile-heading" :aria-busy="loading">
    <RouterLink :to="{ name: 'profile' }" class="back-link profile-back">&larr; Back to profile</RouterLink>
    <header class="home-intro">
      <span class="eyebrow muted">PERSONAL DETAILS</span>
      <h1 id="update-profile-heading">Update your profile.</h1>
      <p>All fields are optional. Save what you like and add more whenever you are ready.</p>
    </header>

    <p v-if="loading" class="profile-loading" role="status">Loading your profile...</p>
    <div v-if="error" class="notice error" role="alert">
      <p>{{ error }}</p>
      <button v-if="!profile" class="inline-button" :disabled="loading" @click="load">Try again</button>
    </div>
    <p v-if="success" class="notice success" role="status">{{ success }}</p>

    <form v-if="profile && !loading" class="profile-card" :aria-busy="saving" @submit.prevent="submit" @input="success = ''" @change="success = ''">
      <fieldset class="profile-fields" :disabled="saving">
        <legend class="sr-only">Optional personal details</legend>
        <div class="field profile-full-width">
          <label for="profile-name">Full name</label>
          <input id="profile-name" v-model="form.full_name" name="full_name" autocomplete="name" maxlength="200" placeholder="Your full name" />
        </div>
        <div class="field">
          <label for="profile-age">Age (years)</label>
          <input id="profile-age" v-model="form.age" name="age" type="number" inputmode="numeric" min="0" max="150" step="1" placeholder="e.g. 30" />
        </div>
        <div class="field">
          <label for="profile-gender">Gender</label>
          <select id="profile-gender" v-model="form.gender" name="gender">
            <option value="">Leave blank</option>
            <option v-for="gender in PROFILE_GENDERS" :key="gender.id" :value="gender.id">{{ gender.name }}</option>
          </select>
        </div>
        <div class="field">
          <label for="profile-height">Height (cm)</label>
          <input id="profile-height" v-model="form.height_cm" name="height_cm" type="number" inputmode="decimal" min="0.01" max="300" step="0.01" placeholder="e.g. 170" />
        </div>
        <div class="field">
          <label for="profile-weight">Weight (kg)</label>
          <input id="profile-weight" v-model="form.weight_kg" name="weight_kg" type="number" inputmode="decimal" min="0.01" max="1000" step="0.01" placeholder="e.g. 65" />
        </div>
        <div class="field profile-full-width">
          <label for="profile-ethnicity">Ethnicity</label>
          <select id="profile-ethnicity" v-model="form.ethnicity" name="ethnicity" aria-describedby="ethnicity-hint">
            <option value="">Leave blank</option>
            <option v-for="ethnicity in options.ethnicities" :key="ethnicity.id" :value="ethnicity.id">{{ ethnicity.name }}</option>
          </select>
          <small id="ethnicity-hint">Choose the option you identify with most closely, or leave this blank.</small>
        </div>
      </fieldset>
      <div class="profile-form-actions">
        <button type="submit" class="primary-button" :disabled="saving">
          <span>{{ saving ? 'Saving...' : 'Save profile' }}</span><span aria-hidden="true">&rarr;</span>
        </button>
        <RouterLink :to="{ name: 'profile' }" class="back-link">Back to profile</RouterLink>
      </div>
    </form>
  </section>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { useUserProfile } from '../composables/useUserProfile.js'
import { PROFILE_GENDERS, profileChanges, profileForm } from '../utils/profile.js'

const { profile, options, loading, saving, error, load, save } = useUserProfile({ includeOptions: true })
const form = reactive({})
const success = ref('')

watch(profile, (value) => {
  if (value) Object.assign(form, profileForm(value))
})

async function submit() {
  if (saving.value) return
  success.value = ''
  if (await save(profileChanges(form, profile.value))) {
    success.value = profile.value.isProfileCompleted
      ? 'Profile saved. Your profile is complete.'
      : 'Profile saved. You can add more details anytime.'
  }
}
</script>
