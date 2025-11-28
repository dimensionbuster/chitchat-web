<script setup lang="ts">
import DrawerMenuItem from '@/components/drawer/DrawerMenuItem.vue'

defineOptions({ name: 'GoHomeAction' })

const emit = defineEmits<{
  goHome: []
}>()

const handleGoHome = () => {
  emit('goHome')
}
</script>

<template>
  <DrawerMenuItem
    icon="🏠"
    label="홈으로"
    @click="handleGoHome"
  />
</template>
