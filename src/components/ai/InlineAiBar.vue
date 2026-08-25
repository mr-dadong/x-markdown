<template>
  <Transition name="inline-ai">
    <div v-if="visible" class="inline-ai-bar" contenteditable="false">
      <!-- 加载状态 -->
      <Transition name="inline-ai-fade" mode="out-in">
        <div v-if="isStreaming" key="loading" class="inline-ai-state inline-ai-loading">
          <div class="inline-ai-spinner">
            <svg viewBox="0 0 24 24" class="inline-ai-spinner-svg">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="60 40" stroke-linecap="round" />
            </svg>
          </div>
          <div class="inline-ai-loading-text">
            <span class="inline-ai-action-name">{{ actionLabel }}</span>
            <span class="inline-ai-dots">
              <span>.</span><span>.</span><span>.</span>
            </span>
          </div>
          <button type="button" class="inline-ai-btn inline-ai-stop" title="停止" @mousedown.prevent.stop="$emit('cancel')">
            <Icon icon="lucide:square" :size="10" />
          </button>
        </div>

        <!-- 结果预览 -->
        <div v-else-if="result" key="result" class="inline-ai-state inline-ai-result">
          <div class="inline-ai-result-header">
            <div class="inline-ai-result-badge">
              <Icon icon="lucide:sparkles" :size="12" />
              <span>AI 结果</span>
            </div>
            <div class="inline-ai-result-actions">
              <button type="button" class="inline-ai-btn inline-ai-accept" @mousedown.prevent.stop="$emit('accept')">
                <Icon icon="lucide:check" :size="13" />
                <span>接受</span>
              </button>
              <button type="button" class="inline-ai-btn inline-ai-reject" @mousedown.prevent.stop="$emit('reject')">
                <Icon icon="lucide:x" :size="13" />
              </button>
            </div>
          </div>
          <div class="inline-ai-result-content" ref="resultRef">
            <div class="inline-ai-result-text">{{ displayedResult }}</div>
            <div v-if="result.length > maxPreviewLength" class="inline-ai-result-more">
              共 {{ result.length }} 字符
            </div>
          </div>
        </div>

        <!-- 错误状态 -->
        <div v-else-if="error" key="error" class="inline-ai-state inline-ai-error">
          <Icon icon="lucide:alert-circle" :size="14" class="inline-ai-error-icon" />
          <span class="inline-ai-error-text">{{ error }}</span>
          <button type="button" class="inline-ai-btn inline-ai-retry" @mousedown.prevent.stop="$emit('retry')">
            <Icon icon="lucide:rotate-ccw" :size="12" />
            <span>重试</span>
          </button>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { AiEditAction } from '../../types/ai'

const props = defineProps<{
  isStreaming: boolean
  result: string
  error: string
  currentAction: AiEditAction | null
}>()

defineEmits<{
  accept: []
  reject: []
  cancel: []
  retry: []
}>()

const maxPreviewLength = 300
const resultRef = ref<HTMLElement | null>(null)

const visible = computed(() => props.isStreaming || !!props.result || !!props.error)

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
}

const actionLabel = computed(() => {
  return props.currentAction ? actionLabels[props.currentAction] : '处理'
})

const displayedResult = computed(() => {
  if (props.result.length <= maxPreviewLength) return props.result
  return props.result.slice(0, maxPreviewLength) + '…'
})

// 结果更新时自动滚动到底部
watch(() => props.result, () => {
  if (resultRef.value) {
    resultRef.value.scrollTop = resultRef.value.scrollHeight
  }
})
</script>

<style scoped>
/* 主容器动画 */
.inline-ai-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.inline-ai-leave-active {
  transition: all 0.2s ease-in;
}

.inline-ai-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}

.inline-ai-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

/* 状态切换动画 */
.inline-ai-fade-enter-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.inline-ai-fade-leave-active {
  transition: all 0.15s ease-in;
}

.inline-ai-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.inline-ai-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.inline-ai-bar {
  min-width: 240px;
  max-width: 420px;
  background: var(--color-paper);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

:root.dark .inline-ai-bar {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.15);
}

.inline-ai-state {
  padding: 10px 12px;
}

/* 加载状态 */
.inline-ai-loading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.inline-ai-spinner {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  color: var(--color-accent);
}

.inline-ai-spinner-svg {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.inline-ai-loading-text {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-size: 13px;
  color: var(--color-ink);
}

.inline-ai-action-name {
  font-weight: 500;
}

.inline-ai-dots span {
  animation: dotPulse 1.4s infinite;
  opacity: 0;
}

.inline-ai-dots span:nth-child(1) { animation-delay: 0s; }
.inline-ai-dots span:nth-child(2) { animation-delay: 0.2s; }
.inline-ai-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dotPulse {
  0%, 60%, 100% { opacity: 0; }
  30% { opacity: 1; }
}

.inline-ai-stop {
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

.inline-ai-stop:hover {
  background-color: #dc2626 !important;
  color: #ffffff !important;
}

:root.dark .inline-ai-stop:hover {
  background-color: #ef4444 !important;
  color: #ffffff !important;
}

/* 结果状态 */
.inline-ai-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inline-ai-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.inline-ai-result-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-accent);
  padding: 3px 8px;
  background: var(--color-selected);
  border-radius: 4px;
}

.inline-ai-result-actions {
  display: flex;
  gap: 4px;
}

.inline-ai-result-content {
  max-height: 180px;
  overflow-y: auto;
  padding: 10px;
  background: var(--color-panel);
  border-radius: 8px;
  border: 1px solid var(--color-line);
}

.inline-ai-result-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-ink);
  white-space: pre-wrap;
  word-break: break-word;
}

.inline-ai-result-more {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-line);
  font-size: 11px;
  color: var(--color-muted);
  text-align: center;
}

/* 错误状态 */
.inline-ai-error {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inline-ai-error-icon {
  flex-shrink: 0;
  color: var(--color-danger);
}

.inline-ai-error-text {
  flex: 1;
  font-size: 12px;
  color: var(--color-danger);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 按钮通用样式 */
.inline-ai-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.inline-ai-btn:hover {
  background-color: var(--color-toolbar);
  color: var(--color-ink);
}

.inline-ai-accept {
  background: var(--color-accent);
  color: var(--color-inverse);
}

.inline-ai-accept:hover {
  background: var(--color-accent-strong);
  color: var(--color-inverse);
}

.inline-ai-reject {
  padding: 5px 7px;
}

.inline-ai-reject:hover {
  background-color: var(--color-danger);
  color: var(--color-inverse);
}

.inline-ai-retry:hover {
  background-color: var(--color-accent);
  color: var(--color-inverse);
}
</style>
