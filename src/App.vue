<script setup lang="ts"></script>

<template>
  <Suspense>
    <router-view />
    <template #fallback>
      <div class="loading">Loading...</div>
    </template>
  </Suspense>
</template>

<style>
html,
body,
#app {
  height: 100%;
}
html,
body {
  margin: 0;
  padding: 0;
  min-height: 100%;
}
* {
  box-sizing: border-box;
}

.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  font-size: 1.5em;
  color: #666;
}
</style>
