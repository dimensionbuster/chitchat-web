<script setup lang="ts">
defineOptions({ name: 'ChatInput' })
import { ref } from 'vue'

defineProps<{
  disabled: boolean
  isUploading: boolean
}>()

const emit = defineEmits<{
  send: [message: string]
  uploadFile: [file: File]
}>()

const input = ref('')

const onSend = () => {
  if (!input.value.trim()) return
  emit('send', input.value)
  input.value = ''
}

const onFileChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  emit('uploadFile', file)
  // input 초기화
  ;(e.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div class="chat-input">
    <input
      v-model="input"
      placeholder="메시지…"
      class="text-input"
      @keydown.enter="onSend"
      :disabled="disabled"
    />
    <button @click="onSend" :disabled="disabled" class="send-button">Send</button>
    <label class="file-upload-label" :class="{ disabled: disabled || isUploading }">
      {{ isUploading ? '업로드 중...' : '📎 파일' }}
      <input
        type="file"
        @change="onFileChange"
        :disabled="disabled || isUploading"
        style="display: none"
        accept="image/*"
      />
    </label>
  </div>
</template>

<style scoped>
.chat-input {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.text-input {
  flex: 1;
  padding: 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.send-button {
  padding: 6px 12px;
  cursor: pointer;
  background: #0078d4;
  color: white;
  border: none;
  border-radius: 4px;
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-upload-label {
  padding: 6px 12px;
  background: #0078d4;
  color: white;
  border-radius: 4px;
  cursor: pointer;
  display: inline-block;
  transition: opacity 0.2s;
}

.file-upload-label:hover:not(.disabled) {
  opacity: 0.9;
}

.file-upload-label.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
