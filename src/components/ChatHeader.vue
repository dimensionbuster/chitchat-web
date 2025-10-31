<script setup lang="ts">
defineOptions({ name: 'ChatHeader' })

defineProps<{
  roomId: string
}>()

const emit = defineEmits<{
  forceSync: []
  goHome: []
  clearChat: []
  resetAll: []
}>()
</script>

<template>
  <div class="chat-header">
    <h1>P2P Chat + Files (Vue SPA) - {{ roomId }}</h1>
    <div class="button-group">
      <button @click="emit('forceSync')">Force Sync</button>
      <button @click="emit('goHome')">Go Home</button>
      <!-- <button @click="emit('clearChat')">Clear Chat</button> -->
      <!-- <button @click="emit('resetAll')" class="danger">🔧 Reset All (Debug)</button> -->
    </div>
  </div>
</template>

<style scoped>
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.button-group {
  display: flex;
  gap: 8px;
}

h1 {
  margin: 0;
  font-size: 1.2em;
}

button {
  padding: 6px 12px;
  cursor: pointer;
}

button.danger {
  background-color: #ff4444;
  color: white;
  border: none;
  font-weight: bold;
}

button.danger:hover {
  background-color: #cc0000;
}
</style>
