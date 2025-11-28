<script setup lang="ts">
import { ref } from 'vue'
import StateExportAction from '@/components/drawer/actions/StateExportAction.vue'
import StateImportAction from '@/components/drawer/actions/StateImportAction.vue'
import ReloadAction from '@/components/drawer/actions/ReloadAction.vue'
import ResyncAction from '@/components/drawer/actions/ResyncAction.vue'
import GoHomeAction from '@/components/drawer/actions/GoHomeAction.vue'

defineOptions({ name: 'HeaderDrawer' })

// Electron 환경 감지는 이제 prop으로 받음
defineProps<{
  roomId: string
  disabled?: boolean
  isElectron?: boolean
}>()

const emit = defineEmits<{
  export: []
  import: []
  reload: []
  resync: []
  goHome: []
}>()

const isOpen = ref(false)

const toggleDrawer = () => {
  isOpen.value = !isOpen.value
}

const closeDrawer = () => {
  isOpen.value = false
}

// 이벤트 핸들러들
const handleExport = () => {
  emit('export')
  closeDrawer()
}

const handleImport = () => {
  emit('import')
  closeDrawer()
}

const handleReload = () => {
  emit('reload')
  closeDrawer()
}

const handleResync = () => {
  emit('resync')
  closeDrawer()
}

const handleGoHome = () => {
  emit('goHome')
  closeDrawer()
}

// 설정 창 열기 (Electron 전용)
const handleOpenSettings = () => {
  if (window.electronApi) {
    window.electronApi.openSettings()
  }
  closeDrawer()
}
</script>

<template>
  <div class="header-drawer">
    <!-- Drawer 버튼 -->
    <button class="drawer-toggle" @click="toggleDrawer" :title="'메뉴'">
      <span class="hamburger-icon">☰</span>
    </button>

    <!-- Backdrop과 Drawer를 body에 Teleport -->
    <Teleport to="body">
      <!-- Backdrop (배경 클릭 시 닫기) -->
      <Transition name="fade">
        <div
          v-if="isOpen"
          class="drawer-backdrop"
          @click="closeDrawer"
        ></div>
      </Transition>

      <!-- Drawer 메뉴 -->
      <Transition name="slide">
        <div v-if="isOpen" class="drawer-menu" :class="{ electron: isElectron }">
          <div class="drawer-header">
            <h3>메뉴</h3>
            <button class="close-btn" @click="closeDrawer">✕</button>
          </div>

          <div class="drawer-content">
            <!-- 상태 관리 섹션 -->
            <div class="menu-section">
              <div class="section-title">상태 관리</div>
              <StateExportAction
                :roomId="roomId"
                :disabled="disabled"
                @export="handleExport"
              />
              <StateImportAction
                :disabled="disabled"
                @import="handleImport"
              />
            </div>

            <!-- 동기화 섹션 -->
            <div class="menu-section">
              <div class="section-title">동기화</div>
              <ReloadAction @reload="handleReload" />
              <ResyncAction
                :disabled="disabled"
                @resync="handleResync"
              />
            </div>

            <!-- 테마 설정 섹션 (Electron 전용) -->
            <div v-if="isElectron" class="menu-section">
              <div class="section-title">테마 설정</div>
              <button class="menu-item" @click="handleOpenSettings">
                <span class="menu-icon">⚙️</span>
                <span class="menu-label">스타일 설정 열기</span>
              </button>
            </div>

            <!-- 네비게이션 섹션 -->
            <div class="menu-section">
              <div class="section-title">네비게이션</div>
              <GoHomeAction @goHome="handleGoHome" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.header-drawer {
  display: inline-block;
}

.drawer-toggle {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--gradient-primary);
  color: var(--text-on-gradient);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
}

.drawer-toggle:hover {
  box-shadow: var(--shadow-md);
  transform: scale(1.05);
}

.hamburger-icon {
  font-size: var(--font-size-xl);
  line-height: 1;
}
</style>

<style>
/* Global styles for teleported elements */
.drawer-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9998;
  backdrop-filter: blur(4px);
}

.drawer-menu {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  max-width: 85vw;
  height: 100vh;
  background: #ffffff;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(156, 124, 181, 0.15);
}

/* Electron 환경에서 타이틀바 높이만큼 상단 여백 추가 */
.drawer-menu.electron {
  top: 36px;
  height: calc(100vh - 36px);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(156, 124, 181, 0.15);
  background: linear-gradient(135deg, #f5f0f8 0%, #faf8fc 100%);
  flex-shrink: 0;
}

.drawer-header h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #4a3f5c;
}

.drawer-menu .close-btn {
  background: #ffffff;
  border: 1px solid rgba(156, 124, 181, 0.15);
  font-size: 18px;
  cursor: pointer;
  color: #7a6b8a;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.drawer-menu .close-btn:hover {
  background: #efe8f4;
  color: #4a3f5c;
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
}

.menu-section {
  margin-bottom: 12px;
}

.section-title {
  padding: 12px 16px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #b8adc4;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  font-size: 14px;
  color: #4a3f5c;
}

.menu-item:hover {
  background: #f5f0f8;
}

.menu-item:active {
  background: #efe8f4;
}

.menu-item-danger {
  color: #c47a7a;
}

.menu-item-danger:hover {
  background: #f8eeee;
}

.menu-icon {
  font-size: 17px;
  width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.menu-label {
  flex: 1;
  font-weight: 500;
}

/* Animations */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
