<script setup lang="ts">
defineOptions({ name: 'DrawerMenuItem' })

defineProps<{
  icon?: string
  label: string
  variant?: 'default' | 'warning' | 'danger'
  danger?: boolean // shorthand for variant='danger'
  disabled?: boolean
}>()

const emit = defineEmits<{
  click: []
}>()

const handleClick = () => {
  emit('click')
}
</script>

<template>
  <button
    class="drawer-menu-item"
    :class="[`variant-${danger ? 'danger' : (variant || 'default')}`, { disabled }]"
    :disabled="disabled"
    @click="handleClick"
  >
    <span v-if="icon" class="icon">{{ icon }}</span>
    <span class="label">{{ label }}</span>
  </button>
</template>

<style scoped>
.drawer-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-lg);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: left;
  font-size: var(--font-size-base);
}

.drawer-menu-item:hover:not(.disabled) {
  background: var(--bg-secondary);
}

.drawer-menu-item:active:not(.disabled) {
  background: var(--bg-tertiary);
}

.drawer-menu-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon {
  font-size: var(--font-size-lg);
  width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.label {
  flex: 1;
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.variant-warning .label {
  color: var(--color-warning);
}

.variant-danger .label {
  color: var(--color-error);
}
</style>
