<template>
  <Teleport to="body">
    <div class="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-line bg-paper"
      :class="fullscreen ? 'inset-x-6 bottom-6 top-[76px]' : ''"
      :style="panelStyle" contenteditable="false" @mousedown.stop @wheel.stop
      @keydown.esc.prevent="$emit('cancel')">
      <div class="flex h-12 items-center justify-between border-b border-line px-3.5 py-2">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-toolbar text-secondary">
            <Icon :icon="icon" :size="14" />
          </span>
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate text-[13px] font-semibold text-ink">{{ title }}</span>
            <span v-if="description" class="truncate text-[11px] text-muted">{{ description }}</span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button v-if="fullscreenEnabled" type="button" :title="fullscreen ? '退出全屏' : '全屏编辑'"
            class="flex h-7 w-7 items-center justify-center rounded-md border border-line text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            @mousedown.prevent="$emit('toggleFullscreen')">
            <Icon :icon="fullscreen ? 'lucide:minimize-2' : 'lucide:maximize-2'" :size="14" />
          </button>
          <span class="flex h-6 items-center rounded border border-line px-1.5 font-mono text-[9px] text-muted">ESC</span>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col overflow-visible bg-toolbar">
        <slot />
      </div>

      <div class="flex h-12 items-center justify-end gap-2 border-t border-line px-3.5 py-2">
        <button type="button"
          class="flex h-8 items-center rounded-md border border-line bg-paper px-3 text-[11px] text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @mousedown.prevent="$emit('cancel')">取消</button>
        <button type="button"
          class="flex h-8 items-center gap-2 rounded-md bg-ink px-3.5 text-[11px] font-medium text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @mousedown.prevent="$emit('submit')">
          <span>{{ submitLabel ?? '保存' }}</span>
          <span class="font-mono text-[9px] text-inverse/60">Ctrl + Enter</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'
import { computed } from 'vue'

const props = defineProps<{
  icon: string
  description?: string
  position: Record<string, string>
  title: string
  width: number
  height?: number
  fullscreen?: boolean
  fullscreenEnabled?: boolean
  submitLabel?: string
}>()

defineEmits<{
  cancel: []
  submit: []
  toggleFullscreen: []
}>()

const panelStyle = computed(() => {
  if (props.fullscreen) return {}
  const top = props.position.top ?? '76px'
  return {
    ...props.position,
    width: `${props.width}px`,
    // 普通模式始终预留底部空间；指定高度后，源码区会在弹窗内部滚动。
    height: props.height ? `min(${props.height}px, calc(100vh - ${top} - 24px))` : undefined,
    maxHeight: `calc(100vh - ${top} - 24px)`,
  }
})
</script>
