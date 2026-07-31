<template>
  <Teleport to="body">
    <div class="fixed z-50 flex flex-col gap-2.5 rounded-lg border border-line bg-paper p-2.5"
      :style="panelStyle" contenteditable="false" @mousedown.stop @keydown.esc.prevent="$emit('cancel')">
      <div class="flex h-7 items-center justify-between px-1">
        <span class="flex items-center gap-2 text-[12px] font-semibold text-ink">
          <Icon :icon="icon" :size="15" class="text-muted" />
          {{ title }}
        </span>
        <span class="font-mono text-[10px] text-muted/60">ESC</span>
      </div>

      <div class="flex flex-col overflow-visible rounded-lg border border-line bg-toolbar">
        <slot />
      </div>

      <div class="flex h-8 items-center justify-end gap-1">
        <button type="button"
          class="flex h-7 items-center rounded-md px-2.5 text-[11px] text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @mousedown.prevent="$emit('cancel')">取消</button>
        <button type="button"
          class="flex h-7 items-center rounded-md bg-ink px-3 text-[11px] font-medium text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @mousedown.prevent="$emit('submit')">保存</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'
import { computed } from 'vue'

const props = defineProps<{
  icon: string
  position: Record<string, string>
  title: string
  width: number
}>()

defineEmits<{
  cancel: []
  submit: []
}>()

const panelStyle = computed(() => ({
  ...props.position,
  width: `${props.width}px`,
}))
</script>
