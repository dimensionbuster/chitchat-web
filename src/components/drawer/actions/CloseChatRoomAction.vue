<script setup lang="ts">
import DrawerMenuItem from '@/components/drawer/DrawerMenuItem.vue'

defineOptions({ name: 'CloseChatRoomAction' })

const emit = defineEmits<{
  close: []
}>()

const handleClose = () => {
  emit('close')
}
</script>

<template>
  <DrawerMenuItem
    icon="❌"
    label="채팅방 닫기"
    danger
    @click="handleClose"
  />
</template>
