<template>
  <!-- AI 未配置时：引导用户去设置页，不展示动作按钮。 -->
  <div v-if="!isConfigured()" class="flex items-center gap-2 rounded-md bg-ink p-1.5 text-inverse" contenteditable="false">
    <button
      type="button"
      title="打开 AI 设置"
      class="flex h-8 items-center gap-2 rounded-md px-3 text-[12px] font-medium hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-inverse"
      @mousedown.prevent="emit('open-settings')"
    >
      <Icon icon="lucide:sparkles" :size="14" class="shrink-0" />
      <span>配置 AI 后使用</span>
    </button>
  </div>

  <!-- AI 已配置：展示常用动作。 -->
  <div v-else class="flex items-center gap-0.5 rounded-md bg-ink p-1 text-inverse" contenteditable="false">
    <button
      v-for="action in visibleActions"
      :key="action.id"
      type="button"
      :title="action.label"
      class="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-inverse"
      @mousedown.prevent="emit('run', action.id)"
    >
      <Icon :icon="action.icon" :size="14" class="shrink-0" />
      <span>{{ action.label }}</span>
    </button>
    <span class="mx-1 h-5 w-px bg-current opacity-30" />
    <button
      type="button"
      title="更多 AI 动作"
      class="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-inverse"
      @mousedown.prevent="emit('open-panel')"
    >
      <Icon icon="lucide:sparkles" :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'
import { useAiStatus } from '../../composables/useAiStatus'
import type { AiEditAction } from '../../types/ai'

interface ActionItem {
  id: AiEditAction
  label: string
  icon: string
}

const emit = defineEmits<{
  run: [action: AiEditAction]
  'open-panel': []
  'open-settings': []
}>()

const { isConfigured } = useAiStatus()

// 选中文本时展示最常用的 AI 动作，保持工具栏紧凑。
const visibleActions: ActionItem[] = [
  { id: 'polish', label: '润色', icon: 'lucide:wand-2' },
  { id: 'rewrite', label: '重写', icon: 'lucide:refresh-cw' },
  { id: 'summarize', label: '总结', icon: 'lucide:list' },
  { id: 'translate', label: '翻译', icon: 'lucide:languages' },
  { id: 'continue', label: '续写', icon: 'lucide:pen-line' },
]
</script>
