<script setup lang="ts">
import { globalIsInitialSyncing, globalInitialSyncProgress } from '../composables/useYjs'
import ChatRoom from './ChatRoom.vue'

defineOptions({ name: 'ChatRoomWrapper' })

const props = defineProps<{
  roomId?: string
  name?: string
}>()
</script>

<template>
  <!-- 로딩 오버레이 -->
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="globalIsInitialSyncing" class="loading-overlay">
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <div class="loading-text">
            {{ globalInitialSyncProgress || '채팅방 연결 중...' }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- ChatRoom 컴포넌트 (Suspense로 비동기 처리) -->
  <Suspense>
    <ChatRoom :roomId="props.roomId" :name="props.name" />
    <template #fallback>
      <!-- Suspense fallback은 비어있음 - Teleport 오버레이가 대신 표시됨 -->
    </template>
  </Suspense>
</template>

<style scoped>
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid var(--color-primary);
  border-top-color: var(--color-primary-light);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-text {
  font-size: 16px;
  color: var(--text-primary);
  font-weight: 500;
  text-align: center;
  max-width: 280px;
}

/* 페이드 트랜지션 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
