<script setup lang="ts">
defineOptions({ name: 'ProfileAvatar' })

const props = defineProps<{
  imageUrl: string | null
  size?: number
  userName?: string
  clickable?: boolean
}>()

const emit = defineEmits<{
  click: []
}>()

// 기본 크기는 32px
const avatarSize = props.size || 32

// 이니셜 생성 (이름의 첫 글자)
const getInitial = (name?: string): string => {
  if (!name) return '?'
  return name.charAt(0).toUpperCase()
}

// 배경색 생성 (이름 기반)
const getBackgroundColor = (name?: string): string => {
  if (!name) return '#999'

  // 이름을 해시하여 색상 생성
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }

  const hue = hash % 360
  return `hsl(${hue}, 50%, 50%)`
}
</script>

<template>
  <div
    class="profile-avatar"
    :class="{ clickable: clickable }"
    :style="{
      width: `${avatarSize}px`,
      height: `${avatarSize}px`,
      minWidth: `${avatarSize}px`,
      minHeight: `${avatarSize}px`
    }"
    @click="clickable && emit('click')"
  >
    <img
      v-if="imageUrl"
      :src="imageUrl"
      alt="Profile"
      class="avatar-image"
    />
    <div
      v-else
      class="avatar-placeholder"
      :style="{ backgroundColor: getBackgroundColor(userName) }"
    >
      <span
        class="avatar-initial"
        :style="{ fontSize: `${avatarSize * 0.5}px` }"
      >
        {{ getInitial(userName) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.profile-avatar {
  border-radius: var(--radius-full);
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 2px solid var(--border-light);
  box-shadow: var(--shadow-sm);
}

.profile-avatar.clickable {
  cursor: pointer;
  transition: all var(--transition-fast);
}

.profile-avatar.clickable:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
  border-color: var(--color-accent);
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: var(--font-weight-bold);
  background: linear-gradient(135deg, var(--color-secondary) 0%, var(--color-accent) 100%);
}

.avatar-initial {
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
</style>
