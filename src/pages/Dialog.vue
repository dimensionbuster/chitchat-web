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
  background: white;
  padding: 0;
  margin: 0;
}

.dialog-container {
  width: 100%;
  height: 100%;
  background: white;
  border-radius: 8px;
  padding: 24px;
  min-width: 280px;
  max-width: 400px;
}

.dialog-message {
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 20px;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
}

.dialog-buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.button {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.button:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.button:active {
  transform: translateY(0);
}

.confirm-button {
  background: #0078d4;
  color: white;
}

.cancel-button {
  background: #e1e1e1;
  color: #333;
}
</style>
