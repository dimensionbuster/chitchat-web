<script setup lang="ts">
import { ref } from 'vue'
import type { ConnectedUser } from '@/composables/useConnectedUsers'

defineOptions({ name: 'ChatHeader' })

defineProps<{
  roomId: string
  userCount?: number
  connectedUsers?: ConnectedUser[]
}>()

const emit = defineEmits<{
  reload: []
  forceResync: []
  goHome: []
  clearChat: []
  resetAll: []
}>()

const showUserList = ref(false)

const toggleUserList = () => {
  showUserList.value = !showUserList.value
}
</script>

<template>
  <div class="chat-header">
    <div class="title-section">
      <h1>ChitChat - {{ roomId }}</h1>
      <button
        class="user-count-btn"
        @click="toggleUserList"
        :title="`접속자 ${userCount || 0}명`"
      >
        👥 {{ userCount || 0 }}
      </button>

      <!-- 접속자 목록 팝업 -->
      <div v-if="showUserList" class="user-list-popup">
        <div class="user-list-header">
          <h3>접속자 목록 ({{ userCount || 0 }}명)</h3>
          <button class="close-btn" @click="showUserList = false">✕</button>
        </div>
        <div class="user-list-content">
          <div v-if="!connectedUsers || connectedUsers.length === 0" class="no-users">
            다른 접속자가 없습니다
          </div>
          <div v-else class="user-item" v-for="user in connectedUsers" :key="user.clientId">
            <div class="user-info">
              <div class="user-nickname">{{ user.nickname }}</div>
              <div class="user-uuid" :title="user.userUuid">{{ user.userUuid }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="button-group">
      <button @click="emit('reload')">Reload</button>
      <button @click="emit('forceResync')" class="warning">🔄 Re-sync</button>
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

.title-section {
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
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

.user-count-btn {
  padding: 4px 10px;
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 16px;
  font-size: 0.9em;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.user-count-btn:hover {
  background-color: #45a049;
  transform: scale(1.05);
}

.user-list-popup {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 8px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 300px;
  max-width: 400px;
  z-index: 1000;
  overflow: hidden;
}

.user-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: #f5f5f5;
  border-bottom: 1px solid #ddd;
}

.user-list-header h3 {
  margin: 0;
  font-size: 1em;
  color: #333;
}

.close-btn {
  padding: 4px 8px;
  background: transparent;
  border: none;
  font-size: 1.2em;
  color: #666;
  cursor: pointer;
  line-height: 1;
}

.close-btn:hover {
  color: #333;
}

.user-list-content {
  max-height: 400px;
  overflow-y: auto;
}

.no-users {
  padding: 32px 16px;
  text-align: center;
  color: #999;
  font-size: 0.9em;
}

.user-item {
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  transition: background-color 0.2s;
}

.user-item:last-child {
  border-bottom: none;
}

.user-item:hover {
  background-color: #f9f9f9;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-nickname {
  font-weight: 600;
  color: #333;
  font-size: 0.95em;
}

.user-uuid {
  font-size: 0.8em;
  color: #666;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button.warning {
  background-color: #ff9800;
  color: white;
  border: none;
  font-weight: bold;
}

button.warning:hover {
  background-color: #e68900;
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
