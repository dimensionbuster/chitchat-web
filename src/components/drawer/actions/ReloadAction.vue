<script setup lang="ts">
import DrawerMenuItem from '@/components/drawer/DrawerMenuItem.vue'

defineOptions({ name: 'ReloadAction' })

const emit = defineEmits<{
  reload: []
}>()

const handleReload = () => {
  emit('reload')
}
</script>

<template>
  <DrawerMenuItem
    icon="🔄"
    label="새로고침"
    @click="handleReload"
  />
</template>
