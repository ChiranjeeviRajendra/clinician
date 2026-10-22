<template>
  <div class="app">
    <!-- Fixed Navbar -->
    <header class="navbar-container">
      <Navbar />
    </header>

    <!-- Page Content -->
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import Navbar from './components/Navbar.vue'
</script>

<style scoped>
.app {
  min-height: 100vh;
}

.navbar-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 64px;
  z-index: 1000;
}

.content {
  padding-top: 64px;
  min-height: 100vh;
  box-sizing: border-box;
}
</style>