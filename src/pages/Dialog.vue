<script setup lang="ts">
defineOptions({ name: 'DialogPage' })
import { onMounted, ref, nextTick } from 'vue'

const props = defineProps<{
  message: string
  type: 'alert' | 'confirm'
  dialogId: string
}>()

const dialogContainerRef = ref<HTMLElement | null>(null)

const handleConfirm = () => {
  if (window.electronApi) {
    window.electronApi.closeDialog(props.dialogId, true)
  }
}

const handleCancel = () => {
  if (window.electronApi) {
    window.electronApi.closeDialog(props.dialogId, false)
  }
}

onMounted(async () => {
  console.log('[Dialog] Mounted:', props)

  // DOM이 완전히 렌더링될 때까지 대기
  await nextTick()

  if (dialogContainerRef.value && window.electronApi) {
    // 실제 렌더링된 컨테이너의 크기 측정
    const rect = dialogContainerRef.value.getBoundingClientRect()

    // 컨테이너의 실제 크기 사용 (추가 패딩 없음)
    const width = Math.ceil(rect.width)
    const height = Math.ceil(rect.height)

    console.log('[Dialog] Container size:', { width, height })

    // Electron에 창 크기 및 표시 요청
    if (window.electronApi.resizeAndShowDialog) {
      window.electronApi.resizeAndShowDialog(props.dialogId, width, height)
    }
  }
})
</script>

<template>
  <div class="dialog-page">
    <div ref="dialogContainerRef" class="dialog-container">
      <div class="dialog-icon">
        {{ type === 'confirm' ? '❓' : 'ℹ️' }}
      </div>
      <div class="dialog-message">{{ message }}</div>
      <div class="dialog-buttons">
        <button v-if="type === 'confirm'" @click="handleCancel" class="button cancel-button">
          취소
        </button>
        <button @click="handleConfirm" class="button confirm-button">
          {{ type === 'confirm' ? '확인' : 'OK' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-page {
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: var(--bg-card-solid, #ffffff);
  padding: 0;
  margin: 0;
}

.dialog-container {
  width: 100%;
  height: 100%;
  background: var(--bg-modal, rgba(255, 255, 255, 0.98));
  border-radius: var(--radius-lg, 14px);
  padding: var(--spacing-xl, 24px);
  min-width: 280px;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 1px solid var(--border-light, rgba(156, 124, 181, 0.15));
}

.dialog-icon {
  font-size: 40px;
  margin-bottom: var(--spacing-lg, 16px);
  filter: drop-shadow(0 2px 4px rgba(156, 124, 181, 0.2));
}

.dialog-message {
  font-size: var(--font-size-base, 14px);
  line-height: var(--line-height-relaxed, 1.7);
  margin-bottom: var(--spacing-xl, 24px);
  color: var(--text-primary, #4a3f5c);
  white-space: pre-wrap;
  word-break: break-word;
  text-align: center;
}

.dialog-buttons {
  display: flex;
  gap: var(--spacing-sm, 8px);
  justify-content: center;
  width: 100%;
}

.button {
  padding: var(--spacing-sm, 10px) var(--spacing-xl, 24px);
  border: 1px solid transparent;
  border-radius: var(--radius-md, 10px);
  font-size: var(--font-size-base, 14px);
  font-weight: var(--font-weight-medium, 500);
  cursor: pointer;
  transition: all var(--transition-fast, 0.15s ease);
  min-width: 80px;
}

.button:hover {
  transform: translateY(-1px);
}

.button:active {
  transform: translateY(0);
}

.confirm-button {
  background: var(--gradient-primary, linear-gradient(135deg, #e8d5f2 0%, #f0d4e8 50%, #fce4ec 100%));
  color: var(--text-on-gradient, #5c4a6e);
  border-color: var(--border-default, rgba(156, 124, 181, 0.25));
  box-shadow: var(--shadow-sm, 0 2px 8px rgba(156, 124, 181, 0.1));
}

.confirm-button:hover {
  box-shadow: var(--shadow-md, 0 4px 16px rgba(156, 124, 181, 0.15));
}

.cancel-button {
  background: var(--bg-secondary, #f5f0f8);
  color: var(--text-secondary, #7a6b8a);
  border-color: var(--border-default, rgba(156, 124, 181, 0.25));
}

.cancel-button:hover {
  background: var(--bg-tertiary, #efe8f4);
  color: var(--text-primary, #4a3f5c);
}
</style>
