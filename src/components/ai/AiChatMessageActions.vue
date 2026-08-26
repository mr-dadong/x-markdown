<template>
  <div class="msg-actions">
    <button type="button" class="msg-actions__btn" title="复制" @mousedown.prevent="emit('copy')">
      <Icon icon="lucide:copy" :size="12" />
    </button>
    <button type="button" class="msg-actions__btn" title="插入" @mousedown.prevent="emit('insert')">
      <Icon icon="lucide:corner-down-left" :size="12" />
    </button>
    <button v-if="!isStreaming" type="button" class="msg-actions__btn" title="重新生成" @mousedown.prevent="emit('retry')">
      <Icon icon="lucide:rotate-ccw" :size="12" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'

defineProps<{
  messageId: string
  isStreaming?: boolean
}>()

const emit = defineEmits<{
  insert: []
  copy: []
  retry: []
}>()
</script>

<style scoped>
.msg-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-line);
}

.msg-actions__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.msg-actions__btn:hover {
  background: var(--color-toolbar);
  color: var(--color-ink);
}

.msg-actions__btn:active {
  transform: scale(0.95);
}
</style>
