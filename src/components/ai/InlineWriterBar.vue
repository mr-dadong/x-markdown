<template>
  <Transition name="inline-writer">
    <div v-if="visible" class="inline-writer-bar" contenteditable="false">
      <!-- 加载状态 -->
      <Transition name="inline-writer-fade" mode="out-in">
        <div v-if="isStreaming" key="loading" class="inline-writer-state inline-writer-loading">
          <div class="inline-writer-spinner">
            <svg viewBox="0 0 24 24" class="inline-writer-spinner-svg">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="60 40" stroke-linecap="round" />
            </svg>
          </div>
          <div class="inline-writer-loading-text">
            <span class="inline-writer-action-name">{{ actionLabel }}</span>
            <span class="inline-writer-dots">
              <span>.</span><span>.</span><span>.</span>
            </span>
          </div>
          <button type="button" class="inline-writer-btn inline-writer-stop" title="停止" @mousedown.prevent.stop="$emit('cancel')">
            <Icon icon="lucide:square" :size="12" />
          </button>
        </div>

        <!-- 完成状态 -->
        <div v-else-if="status === 'done'" key="done" class="inline-writer-state inline-writer-done">
          <div class="inline-writer-done-content">
            <div class="inline-writer-done-info">
              <Icon icon="lucide:check-circle" :size="16" class="inline-writer-done-icon" />
              <span class="inline-writer-done-text">AI 编写完成</span>
            </div>
            <div class="inline-writer-done-actions">
              <button type="button" class="inline-writer-btn inline-writer-accept" @mousedown.prevent.stop="$emit('accept')">
                <Icon icon="lucide:check" :size="14" />
                <span>接受</span>
                <kbd class="inline-writer-kbd">Tab</kbd>
              </button>
              <button type="button" class="inline-writer-btn inline-writer-reject" @mousedown.prevent.stop="$emit('reject')">
                <Icon icon="lucide:x" :size="14" />
                <kbd class="inline-writer-kbd">Esc</kbd>
              </button>
            </div>
          </div>
        </div>

        <!-- 错误状态 -->
        <div v-else-if="error" key="error" class="inline-writer-state inline-writer-error">
          <Icon icon="lucide:alert-circle" :size="16" class="inline-writer-error-icon" />
          <span class="inline-writer-error-text">{{ error }}</span>
          <button type="button" class="inline-writer-btn inline-writer-retry" @mousedown.prevent.stop="$emit('retry')">
            <Icon icon="lucide:rotate-ccw" :size="14" />
            <span>重试</span>
          </button>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { AiEditAction } from '../../types/ai'

const props = defineProps<{
  status: 'idle' | 'streaming' | 'done' | 'error'
  error: string
  currentAction: AiEditAction | null
}>()

defineEmits<{
  accept: []
  reject: []
  cancel: []
  retry: []
}>()

const visible = computed(() =>
  props.status === 'streaming' || props.status === 'done' || !!props.error
)

const isStreaming = computed(() => props.status === 'streaming')

const actionLabels: Record<AiEditAction, string> = {
  polish: '润色',
  rewrite: '重写',
  summarize: '总结',
  translate: '翻译',
  continue: '续写',
  'explain-code': '解释代码',
  'fix-code': '修复代码',
  outline: '生成大纲',
  toc: '生成目录',
  table: '生成表格',
  callout: '生成提示框',
  mermaid: '生成图表',
  frontmatter: '生成元数据',
  'ai-write': 'AI 实时编写',
}

const actionLabel = computed(() => {
  return props.currentAction ? actionLabels[props.currentAction] : 'AI 编写中'
})
</script>

<style scoped>
/* 主容器动画 */
.inline-writer-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.inline-writer-leave-active {
  transition: all 0.2s ease-in;
}

.inline-writer-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}

.inline-writer-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

/* 状态切换动画 */
.inline-writer-fade-enter-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.inline-writer-fade-leave-active {
  transition: all 0.15s ease-in;
}

.inline-writer-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.inline-writer-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.inline-writer-bar {
  min-width: 240px;
  max-width: 380px;
  background: var(--color-paper);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

:root.dark .inline-writer-bar {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.12);
}

.inline-writer-state {
  padding: 10px 12px;
}

/* 加载状态 */
.inline-writer-loading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.inline-writer-spinner {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: var(--color-accent);
}

.inline-writer-spinner-svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.inline-writer-loading-text {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-size: 13px;
  color: var(--color-ink);
}

.inline-writer-action-name {
  font-weight: 500;
}

.inline-writer-dots span {
  animation: dotPulse 1.4s infinite;
  opacity: 0;
}

.inline-writer-dots span:nth-child(1) { animation-delay: 0s; }
.inline-writer-dots span:nth-child(2) { animation-delay: 0.2s; }
.inline-writer-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dotPulse {
  0%, 60%, 100% { opacity: 0; }
  30% { opacity: 1; }
}

.inline-writer-stop {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.inline-writer-stop:hover {
  background-color: #dc2626 !important;
  color: #ffffff !important;
}

:root.dark .inline-writer-stop:hover {
  background-color: #ef4444 !important;
  color: #ffffff !important;
}

/* 完成状态 */
.inline-writer-done {
  padding: 10px 12px;
}

.inline-writer-done-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.inline-writer-done-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.inline-writer-done-icon {
  flex-shrink: 0;
  color: #10b981;
}

.inline-writer-done-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
  white-space: nowrap;
}

.inline-writer-done-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* 错误状态 */
.inline-writer-error {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inline-writer-error-icon {
  flex-shrink: 0;
  color: var(--color-danger);
}

.inline-writer-error-text {
  flex: 1;
  font-size: 12px;
  color: var(--color-danger);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 按钮通用样式 */
.inline-writer-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--color-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.inline-writer-btn:hover {
  background-color: var(--color-toolbar);
  color: var(--color-ink);
}

.inline-writer-accept {
  background: var(--color-accent);
  color: var(--color-inverse);
  font-weight: 600;
}

.inline-writer-accept:hover {
  background: var(--color-accent-strong);
  color: var(--color-inverse);
}

.inline-writer-reject {
  padding: 0 8px;
  background: var(--color-panel);
  border: 1px solid var(--color-line);
}

.inline-writer-reject:hover {
  background: var(--color-toolbar);
  border-color: var(--color-muted);
}

.inline-writer-retry:hover {
  background-color: var(--color-accent);
  color: var(--color-inverse);
}

/* 快捷键提示 */
.inline-writer-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 4px;
  font-size: 10px;
  font-family: inherit;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 3px;
  margin-left: 3px;
}

.inline-writer-accept .inline-writer-kbd {
  background: rgba(255, 255, 255, 0.2);
}

.inline-writer-reject .inline-writer-kbd {
  background: rgba(0, 0, 0, 0.08);
  color: var(--color-muted);
}
</style>
