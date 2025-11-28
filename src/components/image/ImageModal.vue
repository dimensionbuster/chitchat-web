<script setup lang="ts">
defineOptions({ name: 'ImageModal' })
import { ref, onMounted, onUnmounted } from 'vue'

defineProps<{
  imageUrl: string
  fileName: string
}>()

const emit = defineEmits<{
  close: []
  download: []
}>()

const showOverlay = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

const handleMouseMove = () => {
  showOverlay.value = true

  if (hideTimer) {
    clearTimeout(hideTimer)
  }

  hideTimer = setTimeout(() => {
    showOverlay.value = false
  }, 2000)
}

const handleClose = () => {
  emit('close')
}

const handleDownload = () => {
  emit('download')
}

onMounted(() => {
  // 초기에 잠깐 보여주기
  showOverlay.value = true
  hideTimer = setTimeout(() => {
    showOverlay.value = false
  }, 2000)
})

onUnmounted(() => {
  if (hideTimer) {
    clearTimeout(hideTimer)
  }
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click="handleClose" @mousemove="handleMouseMove">
      <div class="modal-content" @click.stop>
        <!-- 닫기 버튼 - 오버레이로 표시 -->
        <button
          class="modal-close"
          :class="{ show: showOverlay }"
          @click="handleClose"
        >
          ✕
        </button>

        <!-- 이미지 -->
        <div class="modal-image-container">
          <img
            :src="imageUrl"
            :alt="fileName"
            class="modal-image"
          />
        </div>

        <!-- 하단 오버레이 (파일명 + 다운로드 버튼) -->
        <div class="modal-footer-overlay" :class="{ show: showOverlay }">
          <div class="modal-filename">{{ fileName }}</div>
          <button class="modal-download-button" @click="handleDownload">
            <span class="download-icon">⬇</span>
            <span>다운로드</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  cursor: pointer;
}

.modal-content {
  position: relative;
  width: 100vw;
  height: 100vh;
  cursor: default;
  display: flex;
  flex-direction: column;
}

.modal-close {
  position: absolute;
  top: 24px;
  right: 24px;
  width: 44px;
  height: 44px;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  border: none;
  border-radius: 50%;
  font-size: 24px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: all 0.3s ease;
  opacity: 0;
  pointer-events: none;
  backdrop-filter: blur(10px);
}

.modal-close.show {
  opacity: 1;
  pointer-events: auto;
}

.modal-close:hover {
  background: rgba(0, 0, 0, 0.8);
  transform: scale(1.1);
}

.modal-image-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 40px;
}

.modal-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  user-select: none;
}

.modal-footer-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 16px 24px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  transition: all 0.3s ease;
  opacity: 0;
  pointer-events: none;
}

.modal-footer-overlay.show {
  opacity: 1;
  pointer-events: auto;
}

.modal-filename {
  flex: 1;
  font-size: 14px;
  color: white;
  font-weight: 500;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-download-button {
  padding: 8px 16px;
  background: transparent;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
  backdrop-filter: blur(10px);
}

.modal-download-button:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.6);
  transform: translateY(-1px);
}

.download-icon {
  font-size: 14px;
}
</style>
