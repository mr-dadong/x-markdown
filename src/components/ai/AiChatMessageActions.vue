<template>
  <!-- 消息操作栏：轻量小图标按钮，不再使用分隔线 -->
  <div class="mt-2 flex items-center gap-0.5">
    <button
      type="button"
      class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-selected hover:text-ink active:scale-95"
      title="复制"
      @mousedown.prevent="emit('copy')"
    >
      <Icon icon="lucide:copy" :size="12" />
    </button>
    <button
      type="button"
      class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-selected hover:text-ink active:scale-95"
      title="插入"
      @mousedown.prevent="emit('insert')"
    >
      <Icon icon="lucide:corner-down-left" :size="12" />
    </button>
    <button
      v-if="!isStreaming"
      type="button"
      class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-selected hover:text-ink active:scale-95"
      title="重新生成"
      @mousedown.prevent="emit('retry')"
    >
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
