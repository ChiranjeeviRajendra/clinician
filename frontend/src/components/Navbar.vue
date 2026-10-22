<template>
  <nav class="navbar">
    <div class="navbar-left">
      <!-- Vue Logo -->
      <router-link to="/" class="logo">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 261.76 226.69"
          class="vue-logo"
        >
          <path
            d="M161.92 0L130.88 53.75 99.84 0H0l130.88 226.69L261.76 0h-99.84z"
            fill="#41B883"
          />
          <path
            d="M161.92 0l-31.04 53.75L99.84 0H52.7l78.18 135.4L209.06 0h-47.14z"
            fill="#34495E"
          />
        </svg>
      </router-link>

      <!-- Navigation Items -->
      <div class="nav-items">
        <router-link to="/chat" class="nav-item">
          Chat
        </router-link>

        <router-link to="/profile" class="nav-item">
          Profile
        </router-link>
      </div>
    </div>
  </nav>
</template>

<script setup>
// No JavaScript required for now
</script>

<style scoped>
.navbar {
  width: 100%;
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  box-sizing: border-box;
  background-color: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.navbar-left {
  display: flex;
  align-items: center;
  gap: 40px;
}

.logo {
  display: flex;
  align-items: center;
  text-decoration: none;
}

.vue-logo {
  width: 38px;
  height: 34px;
}

.nav-items {
  display: flex;
  align-items: center;
  gap: 28px;
}

.nav-item {
  color: #374151;
  text-decoration: none;
  font-size: 16px;
  font-weight: 500;
  transition: color 0.2s ease;
}

.nav-item:hover {
  color: #42b883;
}

.nav-item.router-link-active {
  color: #42b883;
  font-weight: 600;
}
</style>