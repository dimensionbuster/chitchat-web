<script setup lang="ts">
import { ref } from 'vue'
import DrawerMenuItem from '@/components/drawer/DrawerMenuItem.vue'

defineOptions({ name: 'ResyncAction' })

defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  resync: []
}>()

const isResyncing = ref(false)

const handleResync = async () => {
  if (isResyncing.value) return

  try {
    isResyncing.value = true
    emit('resync')
  } finally {
    setTimeout(() => {
      isResyncing.value = false
    }, 2000)
  }
}
</script>

<template>
  <DrawerMenuItem
    icon="🔄"
    label="강제 재동기화"
    variant="warning"
    :disabled="disabled || isResyncing"
    @click="handleResync"
  />
</template>
