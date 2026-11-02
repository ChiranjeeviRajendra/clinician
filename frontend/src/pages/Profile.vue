<template>
  <section class="profile-page" aria-labelledby="profile-heading" :aria-busy="loading">

    <p v-if="loading" class="profile-loading" role="status">Loading your profile...</p>
    <div v-if="error" class="notice error" role="alert">
      <p>{{ error }}</p>
      <button class="inline-button" :disabled="loading" @click="load">Try again</button>
    </div>

    <div v-if="profile && !loading" class="profile-card">
      <div class="profile-card-heading">
        <div>
          <h2>{{ auth.displayName || 'Personal details' }}</h2>
        </div>
        <span class="profile-status">{{ profile.isProfileCompleted ? 'Profile complete' : 'Profile incomplete' }}</span>
      </div>
      <dl class="profile-details">
        <div><dt>Full name</dt><dd>{{ profile.full_name ?? 'Not added' }}</dd></div>
        <div><dt>Date of birth</dt><dd>{{ formatDateOfBirth(profile.date_of_birth) }}</dd></div>
        <div><dt>Gender</dt><dd>{{ genderLabel(profile.gender) }}</dd></div>
        <div><dt>Height</dt><dd>{{ profile.height_cm == null ? 'Not added' : `${profile.height_cm} cm` }}</dd></div>
        <div><dt>Weight</dt><dd>{{ profile.weight_kg == null ? 'Not added' : `${profile.weight_kg} kg` }}</dd></div>
        <div><dt>Ethnicity</dt><dd>{{ profile.ethnicity_name ?? 'Not added' }}</dd></div>
      </dl>
      <RouterLink :to="{ name: 'update-profile' }" class="primary-button profile-action">
        <span>{{ profile.isProfileCompleted ? 'Update your profile' : 'Complete your profile' }}</span>
        <span aria-hidden="true">&rarr;</span>
      </RouterLink>
    </div>
  </section>
</template>

<script setup>
import { useUserProfile } from '../composables/useUserProfile.js'
import { useAuthStore } from '../stores/auth.js'
import { formatDateOfBirth, genderLabel } from '../utils/profile.js'

defineOptions({ name: 'UserProfilePage' })

const auth = useAuthStore()
const { profile, loading, error, load } = useUserProfile()
</script>
