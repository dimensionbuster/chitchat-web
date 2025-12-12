<script setup lang="ts">
import { ref, watch } from 'vue'

interface SavedRoom {
  roomId: string
  nickname: string
  lastVisited: number
}

const props = defineProps<{
  show: boolean
  editingRoom: SavedRoom | null
  defaultNickname?: string
}>()

const emit = defineEmits<{
  close: []
  save: [roomId: string, nickname: string]
  quickJoin: [roomId: string, nickname: string]
}>()

const newRoomId = ref('')
const newNickname = ref('')

// props 변경 시 입력값 초기화
watch(() => props.show, (show) => {
  if (show) {
    if (props.editingRoom) {
      newRoomId.value = props.editingRoom.roomId
      newNickname.value = props.editingRoom.nickname
    } else {
      newRoomId.value = ''
      newNickname.value = props.defaultNickname || ''
    }
  }
})

const handleSave = () => {
  emit('save', newRoomId.value.trim() || 'default-room', newNickname.value.trim() || 'User')
}

const handleQuickJoin = () => {
  emit('quickJoin', newRoomId.value.trim() || 'default-room', newNickname.value.trim() || 'User')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-overlay" @click.self="emit('close')">
        <div class="modal-content">
          <div class="modal-header">
            <h3>{{ editingRoom ? '채팅방 수정' : '새 채팅방' }}</h3>
            <button class="modal-close" @click="emit('close')">✕</button>
          </div>

          <div class="modal-body">
            <label class="input-group">
              <span class="input-label">Room ID</span>
              <input
                v-model="newRoomId"
                placeholder="채팅방 ID를 입력하세요"
                class="text-input"
                @keypress.enter="handleQuickJoin"
              />
            </label>

            <label class="input-group">
              <span class="input-label">닉네임</span>
              <input
                v-model="newNickname"
                placeholder="닉네임을 입력하세요"
                class="text-input"
                @keypress.enter="handleQuickJoin"
              />
            </label>
          </div>

          <div class="modal-footer">
            <button class="modal-btn cancel-btn" @click="emit('close')">취소</button>
            <button class="modal-btn save-btn" @click="handleSave">저장만</button>
            <button class="modal-btn enter-btn" @click="handleQuickJoin">
              {{ editingRoom ? '저장 후 입장' : '저장 & 입장' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: var(--bg-card-solid, var(--bg-primary));
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  width: 90%;
  max-width: 400px;
  box-shadow: var(--shadow-xl);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--border-light);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.modal-close {
  background: none;
  border: none;
  font-size: var(--font-size-lg);
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.modal-close:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.modal-body {
  padding: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--border-light);
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.text-input {
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  transition: all var(--transition-fast);
}

.text-input::placeholder {
  color: var(--text-muted);
}

.text-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.15);
  background: var(--bg-primary);
}

.modal-btn {
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.cancel-btn {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}

.cancel-btn:hover {
  background: var(--bg-tertiary);
}

.save-btn {
  background: var(--color-primary-light);
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
}

.save-btn:hover {
  background: var(--color-primary);
  color: white;
}

.enter-btn {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  color: white;
  border: none;
}

.enter-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
}

/* 모달 트랜지션 */
.modal-enter-active,
.modal-leave-active {
  transition: all 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.95) translateY(-10px);
}
</style>
