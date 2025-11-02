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
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.profile-avatar.clickable {
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.profile-avatar.clickable:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
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
  font-weight: bold;
}

.avatar-initial {
  line-height: 1;
}
</style>
