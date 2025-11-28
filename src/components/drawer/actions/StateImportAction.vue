<script setup lang="ts">
import { ref } from 'vue'
import DrawerMenuItem from '@/components/drawer/DrawerMenuItem.vue'

defineOptions({ name: 'StateImportAction' })

defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  import: []
}>()

const isImporting = ref(false)

const handleImport = async () => {
  if (isImporting.value) return

  try {
    isImporting.value = true
    emit('import')
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <DrawerMenuItem
    icon="📂"
    label="상태 가져오기"
    :disabled="disabled || isImporting"
    @click="handleImport"
  />
</template>
