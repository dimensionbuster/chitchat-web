<script setup lang="ts">
import { ref } from 'vue'
import DrawerMenuItem from '@/components/drawer/DrawerMenuItem.vue'

defineOptions({ name: 'StateExportAction' })

defineProps<{
  roomId: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  export: [snapshot: Uint8Array]
}>()

const isExporting = ref(false)

const handleExport = async () => {
  if (isExporting.value) return

  try {
    isExporting.value = true
    emit('export', new Uint8Array())
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <DrawerMenuItem
    icon="💾"
    label="상태 내보내기"
    :disabled="disabled || isExporting"
    @click="handleExport"
  />
</template>
