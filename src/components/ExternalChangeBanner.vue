<template>
  <!-- 外部程序改写横幅：只在当前激活文档检测到外部修改时显示，不打断编辑。 -->
  <div class="flex items-center gap-3 border-b border-line bg-toolbar px-4 py-2">
    <Icon icon="lucide:refresh-cw" :size="14" class="shrink-0 text-accent" />
    <span class="min-w-0 flex-1 truncate text-[12.5px] text-secondary">
      “{{ title }}”已在 XMD 之外被修改
    </span>
    <button type="button"
      class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-medium text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      @click="emit('reload')">
      <Icon icon="lucide:download" :size="13" />
      <span>重新加载</span>
    </button>
    <button type="button"
      class="flex h-7 shrink-0 items-center justify-center rounded-md px-3 text-[12px] font-medium text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      @click="emit('dismiss')">
      忽略
    </button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'

defineProps<{ title?: string }>()
const emit = defineEmits<{
  (event: 'reload'): void
  (event: 'dismiss'): void
}>()
</script>