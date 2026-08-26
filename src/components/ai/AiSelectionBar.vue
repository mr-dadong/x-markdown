<template>
  <!-- AI 未配置时：引导用户去设置页，不展示动作按钮。 -->
  <Transition name="ai-bar">
    <div v-if="!isConfigured()" class="ai-bar ai-bar-setup" contenteditable="false">
      <button type="button" title="打开 AI 设置" class="ai-bar-btn ai-bar-setup-btn"
        @mousedown.prevent="emit('open-settings')">
        <Icon icon="lucide:sparkles" :size="14" class="ai-bar-icon" />
        <span>配置 AI 后使用</span>
      </button>
    </div>

    <!-- AI 已配置：展示常用动作。 -->
    <div v-else class="ai-bar ai-bar-actions" contenteditable="false">
      <button v-for="action in visibleActions" :key="action.id" type="button" :title="action.label"
        class="ai-bar-btn ai-bar-action-btn" @mousedown.prevent="emit('run', action.id)">
        <Icon :icon="action.icon" :size="14" class="ai-bar-icon" />
        <span>{{ action.label }}</span>
      </button>
      <span class="ai-bar-divider" />
      <button type="button" title="添加到选取" class="ai-bar-btn ai-bar-icon-only-btn"
        @mousedown.prevent="emit('add-to-selection')">
        <Icon icon="lucide:message-square-plus" :size="14" />
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
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
  'add-to-selection': []
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

<style scoped>
/* 入场/退场动画 */
.ai-bar-enter-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.ai-bar-leave-active {
  transition: all 0.15s ease-in;
}

.ai-bar-enter-from {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}

.ai-bar-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.ai-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--color-ink);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
}

:root.dark .ai-bar {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35), 0 1px 4px rgba(0, 0, 0, 0.2);
}

.ai-bar-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--color-inverse);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.ai-bar-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.ai-bar-btn:active {
  background: rgba(255, 255, 255, 0.18);
  transform: scale(0.97);
}

.ai-bar-icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.ai-bar-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 4px;
}

.ai-bar-icon-only-btn {
  padding: 0 8px;
  height: 28px;
}

.ai-bar-icon-only-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.ai-bar-icon-only-btn:active {
  background: rgba(255, 255, 255, 0.12);
  transform: scale(0.98);
}

.ai-bar-setup-btn {
  gap: 6px;
}
</style>
