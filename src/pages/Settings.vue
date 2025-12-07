<script lang="ts">
export default {
  name: 'SettingsPage'
}
</script>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useStyleSettings, type ColorSettings } from '../composables/useStyleSettings'
import { useNotificationSound } from '../composables/useNotificationSound'

type BackgroundType = 'home' | 'chat' | 'notification'

const {
  settings,
  initialize,
  setContainerOpacity,
  setBackgroundOverlay,
  setBackgroundBlur,
  setColor,
  applyTemplate,
  exportSettings,
  importSettings,
  resetToDefaults,
  notifyBackgroundChange,
  DEFAULT_COLORS,
  COLOR_TEMPLATES
} = useStyleSettings()

// Notification sound settings
const {
  volume: notificationVolume,
  isEnabled: notificationEnabled,
  customSoundUrl,
  hasCustomSound,
  isElectron: soundIsElectron,
  setVolume: setNotificationVolume,
  setEnabled: setNotificationEnabled,
  selectAndSetCustomSound,
  removeCustomSound,
  testSound
} = useNotificationSound()

// Background image previews
const backgroundPreviews = ref<Record<BackgroundType, string | null>>({
  home: null,
  chat: null,
  notification: null
})

// Loading states
const isLoadingBackground = ref<Record<BackgroundType, boolean>>({
  home: false,
  chat: false,
  notification: false
})

const isElectron = computed(() => typeof window !== 'undefined' && !!window.electronApi)

const backgroundTypeLabels: Record<BackgroundType, string> = {
  home: '홈 화면',
  chat: '채팅 화면',
  notification: '알림 화면'
}

// Load background images on mount
async function loadBackgroundPreviews() {
  if (!window.electronApi) return

  const types: BackgroundType[] = ['home', 'chat', 'notification']
  for (const type of types) {
    try {
      const dataUrl = await window.electronApi.getBackgroundImage(type)
      backgroundPreviews.value[type] = dataUrl
    } catch (e) {
      console.error(`Failed to load ${type} background:`, e)
    }
  }
}

// Select background image
async function selectBackground(type: BackgroundType) {
  if (!window.electronApi) return

  isLoadingBackground.value[type] = true
  try {
    const imageData = await window.electronApi.selectBackgroundImage()
    if (imageData) {
      const success = await window.electronApi.setBackgroundImage(type, imageData)
      if (success) {
        const dataUrl = await window.electronApi.getBackgroundImage(type)
        backgroundPreviews.value[type] = dataUrl
        // 다른 창에 배경 변경 알림
        notifyBackgroundChange(type)
      }
    }
  } catch (e) {
    console.error(`Failed to select ${type} background:`, e)
  } finally {
    isLoadingBackground.value[type] = false
  }
}

// Clear background image
async function clearBackground(type: BackgroundType) {
  if (!window.electronApi) return

  try {
    await window.electronApi.removeBackgroundImage(type)
    backgroundPreviews.value[type] = null
    // 다른 창에 배경 변경 알림
    notifyBackgroundChange(type)
  } catch (e) {
    console.error(`Failed to clear ${type} background:`, e)
  }
}

// Close settings window
function closeSettings() {
  window.close()
}

// Notification sound functions
const isLoadingSound = ref(false)

async function selectNotificationSound() {
  isLoadingSound.value = true
  try {
    const success = await selectAndSetCustomSound()
    if (!success) {
      await window.electronApi?.showDialog('소리 파일을 선택할 수 없습니다.')
    }
  } catch (e) {
    console.error('Failed to select notification sound:', e)
  } finally {
    isLoadingSound.value = false
  }
}

async function clearNotificationSound() {
  try {
    await removeCustomSound()
  } catch (e) {
    console.error('Failed to clear notification sound:', e)
  }
}

function handleVolumeChange(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber / 100
  setNotificationVolume(value)
}

function handleEnabledChange(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  setNotificationEnabled(enabled)
}

// Reset all settings
async function handleResetAll() {
  await resetToDefaults()
  // Clear all backgrounds
  const types: BackgroundType[] = ['home', 'chat', 'notification']
  for (const type of types) {
    if (window.electronApi) {
      try {
        await window.electronApi.removeBackgroundImage(type)
        backgroundPreviews.value[type] = null
        notifyBackgroundChange(type)
      } catch (e) {
        console.error(`Failed to clear ${type} background:`, e)
      }
    }
  }
  // Reset notification sound
  await setNotificationVolume(0.5)
  await setNotificationEnabled(true)
  await removeCustomSound()
}

// Computed values for display
const displayContainerOpacity = computed(() => settings.value.containerOpacity.chat)
const displayOverlayOpacity = computed(() => settings.value.backgroundOverlay.chat)
const displayHomeBlur = computed(() => settings.value.backgroundBlur.home)
const displayChatBlur = computed(() => settings.value.backgroundBlur.chat)

// Update container opacity for all types
function handleContainerOpacityChange(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber / 100
  setContainerOpacity('home', value)
  setContainerOpacity('chat', value)
}

// Update overlay opacity for all types
function handleOverlayOpacityChange(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber / 100
  setBackgroundOverlay('home', value)
  setBackgroundOverlay('chat', value)
  setBackgroundOverlay('notification', value)
}

// Update blur for home
function handleHomeBlurChange(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber
  setBackgroundBlur('home', value)
}

// Update blur for chat
function handleChatBlurChange(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber
  setBackgroundBlur('chat', value)
}

// Color setting handlers
function handleColorChange(colorKey: keyof ColorSettings, event: Event) {
  const value = (event.target as HTMLInputElement).value
  setColor(colorKey, value)
}

// Color labels for UI
const colorLabels: Record<keyof ColorSettings, string> = {
  gradientStart: '그라데이션 시작',
  gradientMid: '그라데이션 중간',
  gradientEnd: '그라데이션 끝',
  colorPrimary: '메인 색상',
  colorPrimaryHover: '메인 색상 (호버)',
  colorPrimaryLight: '메인 색상 (연한)',
  colorSecondary: '보조 색상',
  colorAccent: '악센트 색상',
  bgPrimary: '배경색 (메인)',
  bgSecondary: '배경색 (보조)',
  textPrimary: '텍스트 (주요)',
  textSecondary: '텍스트 (보조)',
  textMuted: '텍스트 (흐린)'
}

// Color groups for UI organization
const colorGroups = [
  {
    title: '그라데이션',
    keys: ['gradientStart', 'gradientMid', 'gradientEnd'] as (keyof ColorSettings)[]
  },
  {
    title: '메인/악센트',
    keys: ['colorPrimary', 'colorPrimaryHover', 'colorPrimaryLight', 'colorSecondary', 'colorAccent'] as (keyof ColorSettings)[]
  },
  {
    title: '배경',
    keys: ['bgPrimary', 'bgSecondary'] as (keyof ColorSettings)[]
  },
  {
    title: '텍스트',
    keys: ['textPrimary', 'textSecondary', 'textMuted'] as (keyof ColorSettings)[]
  }
]

// Template selection
function handleTemplateSelect(templateId: string) {
  applyTemplate(templateId)
}

// Export settings to JSON file
function handleExport() {
  const jsonData = exportSettings()
  const blob = new Blob([jsonData], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chitchat-theme-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Import settings from JSON file
function handleImport() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async () => {
    if (input.files && input.files[0]) {
      const file = input.files[0]
      const text = await file.text()
      const success = importSettings(text)
      if (!success) {
        // alert('설정 파일을 불러오는데 실패했습니다. 올바른 형식인지 확인해주세요.')
        await window.electronApi?.showDialog('설정 파일을 불러오는데 실패했습니다. 올바른 형식인지 확인해주세요.')
      }
    }
  }
  document.body.appendChild(input)
  input.click()
  document.body.removeChild(input)
}

onMounted(async () => {
  await initialize()
  await loadBackgroundPreviews()
})
</script>

<template>
  <div class="settings-page">
    <div class="settings-container">
      <!-- Header -->
      <div class="settings-header">
        <h1>설정</h1>
      </div>

      <!-- Content -->
      <div class="settings-content">
        <!-- Background Images Section -->
        <section class="settings-section">
          <h2>배경 이미지</h2>
          <div class="background-grid">
            <div
              v-for="type in (['home', 'chat', 'notification'] as BackgroundType[])"
              :key="type"
              class="background-card"
            >
              <h3>{{ backgroundTypeLabels[type] }}</h3>
              <div
                class="background-preview"
                :class="{ 'has-image': backgroundPreviews[type] }"
              >
                <img
                  v-if="backgroundPreviews[type]"
                  :src="backgroundPreviews[type]!"
                  alt="Background preview"
                />
                <div v-else class="no-image">
                  <span>🖼️</span>
                  <span>이미지 없음</span>
                </div>
              </div>
              <div class="background-actions">
                <button
                  class="btn-select"
                  :disabled="isLoadingBackground[type] || !isElectron"
                  @click="selectBackground(type)"
                >
                  {{ isLoadingBackground[type] ? '선택 중...' : '이미지 선택' }}
                </button>
                <button
                  class="btn-clear"
                  :disabled="!backgroundPreviews[type] || !isElectron"
                  @click="clearBackground(type)"
                >
                  초기화
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Notification Sound Section -->
        <section class="settings-section">
          <h2>알림 소리</h2>
          <p class="section-description">새 메시지가 도착할 때 재생되는 알림 소리를 설정합니다.</p>

          <div class="sound-settings">
            <!-- Enable/Disable -->
            <div class="sound-group">
              <div class="sound-header">
                <label class="sound-toggle-label">
                  <input
                    type="checkbox"
                    :checked="notificationEnabled"
                    @change="handleEnabledChange"
                    class="sound-checkbox"
                  />
                  <span>알림 소리 활성화</span>
                </label>
              </div>
            </div>

            <!-- Volume Control -->
            <div class="sound-group" v-if="notificationEnabled">
              <div class="opacity-header">
                <label>음량</label>
                <span class="opacity-value">{{ Math.round(notificationVolume * 100) }}%</span>
              </div>
              <div class="slider-container">
                <span class="slider-label">🔇</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  :value="Math.round(notificationVolume * 100)"
                  @input="handleVolumeChange"
                  class="slider"
                />
                <span class="slider-label">🔊</span>
              </div>
            </div>

            <!-- Custom Sound File -->
            <div class="sound-group" v-if="notificationEnabled">
              <div class="sound-file-header">
                <label>알림 소리 파일</label>
                <span class="sound-file-status">
                  {{ hasCustomSound ? '커스텀 소리 사용 중' : '기본 소리 사용 중 (nope.mp3)' }}
                </span>
              </div>
              <div class="sound-file-actions">
                <button
                  class="btn-select"
                  :disabled="isLoadingSound || !soundIsElectron"
                  @click="selectNotificationSound"
                >
                  {{ isLoadingSound ? '선택 중...' : '소리 파일 선택' }}
                </button>
                <button
                  class="btn-clear"
                  :disabled="!hasCustomSound || !soundIsElectron"
                  @click="clearNotificationSound"
                >
                  기본값으로 초기화
                </button>
                <button
                  class="btn-test"
                  @click="testSound"
                >
                  🔊 테스트
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Opacity Settings Section -->
        <section class="settings-section">
          <h2>투명도 설정</h2>

          <div class="opacity-settings">
            <!-- Container Opacity -->
            <div class="opacity-group">
              <div class="opacity-header">
                <label>컨테이너 투명도</label>
                <span class="opacity-value">{{ Math.round(displayContainerOpacity * 100) }}%</span>
              </div>
              <p class="opacity-description">
                콘텐츠 영역 배경의 투명도를 조절합니다. 값이 낮을수록 배경 이미지가 더 잘 보입니다.
              </p>
              <div class="slider-container">
                <span class="slider-label">투명</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  :value="Math.round(displayContainerOpacity * 100)"
                  @input="handleContainerOpacityChange"
                  class="slider"
                />
                <span class="slider-label">불투명</span>
              </div>
            </div>

            <!-- Overlay Opacity -->
            <div class="opacity-group">
              <div class="opacity-header">
                <label>오버레이 투명도</label>
                <span class="opacity-value">{{ Math.round(displayOverlayOpacity * 100) }}%</span>
              </div>
              <p class="opacity-description">
                배경 이미지 위에 씌워지는 흰색 오버레이의 투명도입니다. 값이 높을수록 이미지가 더 밝아집니다.
              </p>
              <div class="slider-container">
                <span class="slider-label">투명</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  :value="Math.round(displayOverlayOpacity * 100)"
                  @input="handleOverlayOpacityChange"
                  class="slider"
                />
                <span class="slider-label">불투명</span>
              </div>
            </div>

            <!-- Background Blur -->
            <div class="opacity-group">
              <div class="opacity-header">
                <label>홈 화면 블러 효과</label>
                <span class="opacity-value">{{ Math.round(displayHomeBlur) }}px</span>
              </div>
              <p class="opacity-description">
                홈 화면 컨테이너의 블러 효과 강도를 조절합니다. 값이 높을수록 배경 이미지가 더 흐릿해집니다.
              </p>
              <div class="slider-container">
                <span class="slider-label">선명</span>
                <input
                  type="range"
                  min="0"
                  max="20"
                  :value="Math.round(displayHomeBlur)"
                  @input="handleHomeBlurChange"
                  class="slider"
                />
                <span class="slider-label">흐림</span>
              </div>
            </div>

            <div class="opacity-group">
              <div class="opacity-header">
                <label>채팅 화면 블러 효과</label>
                <span class="opacity-value">{{ Math.round(displayChatBlur) }}px</span>
              </div>
              <p class="opacity-description">
                채팅 화면 컨테이너의 블러 효과 강도를 조절합니다. 값이 높을수록 배경 이미지가 더 흐릿해집니다.
              </p>
              <div class="slider-container">
                <span class="slider-label">선명</span>
                <input
                  type="range"
                  min="0"
                  max="20"
                  :value="Math.round(displayChatBlur)"
                  @input="handleChatBlurChange"
                  class="slider"
                />
                <span class="slider-label">흐림</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Color Templates Section -->
        <section class="settings-section">
          <h2>색상 템플릿</h2>
          <p class="section-description">미리 정의된 색상 테마를 선택하거나 직접 설정을 가져오기/내보내기 할 수 있습니다.</p>

          <div class="template-grid">
            <button
              v-for="template in COLOR_TEMPLATES"
              :key="template.id"
              class="template-card"
              @click="handleTemplateSelect(template.id)"
            >
              <div class="template-preview">
                <div
                  class="template-gradient"
                  :style="{
                    background: `linear-gradient(135deg, ${template.colors.gradientStart} 0%, ${template.colors.gradientMid} 50%, ${template.colors.gradientEnd} 100%)`
                  }"
                ></div>
                <div class="template-colors">
                  <span :style="{ background: template.colors.colorPrimary }"></span>
                  <span :style="{ background: template.colors.colorSecondary }"></span>
                  <span :style="{ background: template.colors.colorAccent }"></span>
                </div>
              </div>
              <div class="template-info">
                <span class="template-name">{{ template.name }}</span>
                <span class="template-desc">{{ template.description }}</span>
              </div>
            </button>
          </div>

          <div class="import-export-buttons">
            <button class="btn-export" @click="handleExport">
              📤 설정 내보내기
            </button>
            <button class="btn-import" @click="handleImport">
              📥 설정 가져오기
            </button>
          </div>
        </section>

        <!-- Color Settings Section -->
        <section class="settings-section">
          <h2>색상 설정</h2>

          <div class="color-settings">
            <div
              v-for="group in colorGroups"
              :key="group.title"
              class="color-group"
            >
              <h3 class="color-group-title">{{ group.title }}</h3>
              <div class="color-items">
                <div
                  v-for="colorKey in group.keys"
                  :key="colorKey"
                  class="color-item"
                >
                  <label class="color-label">{{ colorLabels[colorKey] }}</label>
                  <div class="color-input-wrapper">
                    <input
                      type="color"
                      :value="settings.colors[colorKey]"
                      @input="handleColorChange(colorKey, $event)"
                      class="color-picker"
                    />
                    <input
                      type="text"
                      :value="settings.colors[colorKey]"
                      @change="handleColorChange(colorKey, $event)"
                      class="color-text"
                      maxlength="7"
                    />
                    <button
                      class="color-reset-btn"
                      @click="setColor(colorKey, DEFAULT_COLORS[colorKey])"
                      title="기본값으로 초기화"
                    >
                      ↺
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Reset Button -->
        <div class="settings-footer">
          <button class="btn-reset" @click="handleResetAll">
            모든 설정 초기화
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  height: calc(100vh - 32px);
  background: linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-end) 100%);
  padding: 1rem;
  overflow-y: auto;
}

.settings-container {
  max-width: 700px;
  width: 100%;
  margin: 0 auto;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-end) 100%);
  color: var(--text-on-gradient, white);
}

.settings-header h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: rgba(var(--bg-primary-rgb, 255, 255, 255), 0.2);
  color: var(--text-on-gradient, white);
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.close-btn:hover {
  background: rgba(var(--bg-primary-rgb, 255, 255, 255), 0.3);
}

.settings-content {
  padding: 1.5rem;
}

.settings-section {
  margin-bottom: 2rem;
}

.settings-section:last-of-type {
  margin-bottom: 1rem;
}

.settings-section h2 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 1rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--color-primary-light);
}

/* Background Grid */
.background-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

.background-card {
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  border: 1px solid var(--border-light);
}

.background-card h3 {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
  text-align: center;
}

.background-preview {
  aspect-ratio: 16/10;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.5rem;
}

.background-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.no-image {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.no-image span:first-child {
  font-size: 1.5rem;
  opacity: 0.5;
}

.background-actions {
  display: flex;
  gap: 0.5rem;
}

.background-actions button {
  flex: 1;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-select {
  background: var(--color-primary);
  color: white;
}

.btn-select:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.btn-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-clear {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.btn-clear:hover:not(:disabled) {
  background: var(--text-muted);
  color: white;
}

.btn-clear:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Notification Sound Settings */
.sound-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.sound-group {
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  padding: 1rem;
  border: 1px solid var(--border-light);
}

.sound-header {
  margin-bottom: 0.5rem;
}

.sound-toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}

.sound-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.sound-file-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.sound-file-header label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.sound-file-status {
  font-size: 0.75rem;
  color: var(--text-secondary);
  padding: 0.25rem 0.5rem;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
}

.sound-file-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.sound-file-actions .btn-select,
.sound-file-actions .btn-clear {
  flex: 1;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
}

.sound-file-actions .btn-select {
  background: var(--color-primary);
  color: white;
}

.sound-file-actions .btn-select:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.sound-file-actions .btn-clear {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.sound-file-actions .btn-clear:hover:not(:disabled) {
  background: var(--text-muted);
  color: white;
}

.btn-test {
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--color-primary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-test:hover {
  background: var(--color-primary);
  color: white;
}

/* Opacity Settings */
.opacity-settings {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.opacity-group {
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  padding: 1rem;
  border: 1px solid var(--border-light);
}

.opacity-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.opacity-header label {
  font-weight: 500;
  color: var(--text-primary);
}

.opacity-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-primary);
  background: var(--color-primary-light);
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-sm);
}

.opacity-description {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin: 0 0 0.75rem 0;
}

.slider-container {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.slider-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  min-width: 40px;
}

.slider-label:last-child {
  text-align: right;
}

.slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  background: linear-gradient(90deg, var(--color-primary-light) 0%, var(--color-primary) 100%);
  border-radius: 3px;
  outline: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: white;
  border: 2px solid var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: white;
  border: 2px solid var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* Section Description */
.section-description {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin: -0.5rem 0 1rem 0;
}

/* Color Templates */
.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.template-card {
  background: var(--bg-secondary);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  padding: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.template-card:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.template-preview {
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.template-gradient {
  height: 40px;
}

.template-colors {
  display: flex;
  height: 12px;
}

.template-colors span {
  flex: 1;
}

.template-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.template-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-primary);
}

.template-desc {
  font-size: 0.65rem;
  color: var(--text-secondary);
  line-height: 1.3;
}

.import-export-buttons {
  display: flex;
  gap: 0.75rem;
}

.btn-export,
.btn-import {
  flex: 1;
  padding: 0.6rem 1rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-export:hover,
.btn-import:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
}

/* Color Settings */
.color-settings {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.color-group {
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  padding: 1rem;
  border: 1px solid var(--border-light);
}

.color-group-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.75rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-light);
}

.color-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
}

.color-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.color-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.color-input-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.color-picker {
  width: 36px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background: transparent;
}

.color-picker::-webkit-color-swatch-wrapper {
  padding: 2px;
}

.color-picker::-webkit-color-swatch {
  border-radius: 3px;
  border: none;
}

.color-text {
  flex: 1;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-family: var(--font-family-mono);
  color: var(--text-primary);
  background: var(--bg-input);
  text-transform: uppercase;
}

.color-text:focus {
  outline: none;
  border-color: var(--color-primary);
}

.color-reset-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.color-reset-btn:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

/* Footer */
.settings-footer {
  text-align: center;
  padding-top: 1rem;
  border-top: 1px solid var(--border-light);
}

.btn-reset {
  padding: 0.6rem 1.5rem;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--text-muted);
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-reset:hover {
  background: var(--text-muted);
  color: white;
  border-color: var(--text-muted);
}

/* Responsive */
@media (max-width: 600px) {
  .background-grid {
    grid-template-columns: 1fr;
  }

  .settings-page {
    padding: 0;
  }

  .settings-container {
    border-radius: 0;
    min-height: 100vh;
  }
}
</style>
