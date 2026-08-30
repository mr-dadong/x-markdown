<template>
  <div class="chat-input">
    <!-- 输入卡片：macOS 风格圆角卡片，聚焦时显示柔和光环 -->
    <div class="chat-input__composer">
      <!-- 选区标签列表 -->
      <div v-if="pendingSelections && pendingSelections.length > 0" class="chat-input__selection-tags">
        <div
          v-for="(selection, index) in pendingSelections"
          :key="index"
          class="chat-input__selection-tag"
        >
          <Icon icon="lucide:quote" :size="10" />
          <span class="chat-input__selection-label">{{ truncateText(selection) }}</span>
          <button
            type="button"
            class="chat-input__selection-remove"
            title="移除"
            @mousedown.prevent="$emit('remove-pending-selection', index)"
          >
            <Icon icon="lucide:x" :size="10" />
          </button>
        </div>
      </div>

      <!-- 输入区域 -->
      <textarea
        ref="inputRef"
        v-model="inputText"
        class="chat-input__textarea"
        :placeholder="placeholder"
        :disabled="isStreaming"
        rows="1"
        @keydown="handleKeydown"
        @input="autoResize"
      />

      <!-- 底部工具行：左侧放模型选择等扩展内容，右侧为发送/停止按钮 -->
      <div class="chat-input__footer">
        <div class="chat-input__footer-left">
          <slot name="footer-left" />
        </div>
        <div class="chat-input__buttons">
          <button
            v-if="isStreaming"
            type="button"
            class="chat-input__btn chat-input__btn--stop"
            title="停止生成"
            @mousedown.prevent="$emit('cancel')"
          >
            <Icon icon="lucide:square" :size="14" />
          </button>
          <button
            v-else
            type="button"
            class="chat-input__btn chat-input__btn--send"
            :disabled="!canSend"
            title="发送 (Enter)"
            @mousedown.prevent="handleSend"
          >
            <Icon icon="lucide:arrow-up" :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Icon } from '@iconify/vue/offline'

const props = defineProps<{
  isStreaming: boolean
  pendingSelections?: string[]
}>()

const emit = defineEmits<{
  send: [content: string]
  cancel: []
  'clear-pending-selections': []
  'remove-pending-selection': [index: number]
}>()

const inputRef = ref<HTMLTextAreaElement | null>(null)
const inputText = ref('')

// 输入框最大高度，超出后内部滚动
const MAX_TEXTAREA_HEIGHT = 180

const canSend = computed(() => inputText.value.trim().length > 0 && !props.isStreaming)

const truncateText = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed
}

const placeholder = computed(() => {
  if (props.isStreaming) return '正在生成…'
  return '输入消息…'
})

const handleSend = (): void => {
  if (!canSend.value) return
  let content = inputText.value
  // 如果有 pending selections，附加到消息中
  if (props.pendingSelections && props.pendingSelections.length > 0) {
    const selectionsText = props.pendingSelections
      .map((s, i) => `选区${i + 1}：\n\`\`\`\n${s}\n\`\`\``)
      .join('\n\n')
    content = content + '\n\n' + selectionsText
    emit('clear-pending-selections')
  }
  emit('send', content)
  inputText.value = ''
  nextTick(() => autoResize())
}

const handleKeydown = (event: KeyboardEvent): void => {
  // Enter 发送，Shift+Enter 换行
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}

const autoResize = (): void => {
  const textarea = inputRef.value
  if (!textarea) return
  // 先重置为 auto 才能拿到内容真实高度；空内容时由 CSS min-height 撑起基础高度
  textarea.style.height = 'auto'
  const next = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)
  textarea.style.height = `${next}px`
  textarea.style.overflowY = textarea.scrollHeight > next ? 'auto' : 'hidden'
}

const focus = (): void => {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<style scoped>
.chat-input {
  flex-shrink: 0;
  padding: 10px 12px 8px;
}

/* 输入卡片：多层柔和阴影营造悬浮感，聚焦时加 accent 光环 */
.chat-input__composer {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line);
  border-radius: 16px;
  background: var(--color-panel);
  box-shadow: 0 1px 2px rgba(15, 18, 22, 0.04), 0 4px 16px rgba(15, 18, 22, 0.05);
  transition: border-color 0.18s ease, box-shadow 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.chat-input__composer:focus-within {
  border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 14%, transparent),
    0 1px 2px rgba(15, 18, 22, 0.04), 0 4px 16px rgba(15, 18, 22, 0.05);
}

:root.dark .chat-input__composer {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.35);
}

:root.dark .chat-input__composer:focus-within {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 28%, transparent),
    0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.35);
}

.chat-input__selection-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 10px 12px 0;
}

.chat-input__selection-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px 3px 8px;
  background: var(--color-selected);
  border-radius: 6px;
  font-size: 11px;
  color: var(--color-secondary);
  max-width: fit-content;
}

.chat-input__selection-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-input__selection-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.chat-input__selection-remove:hover {
  background: var(--color-control-hover);
  color: var(--color-ink);
}

.chat-input__textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 56px;
  max-height: 180px;
  border: none;
  background: transparent;
  color: var(--color-ink);
  font-size: 13px;
  line-height: 20px;
  resize: none;
  outline: none;
  font-family: inherit;
  padding: 10px 14px 4px;
  overflow-y: hidden;
}

.chat-input__textarea::placeholder {
  color: var(--color-muted);
}

.chat-input__textarea:disabled {
  opacity: 0.6;
}

.chat-input__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px 8px 10px;
}

.chat-input__footer-left {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.chat-input__buttons {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.chat-input__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
}

.chat-input__btn--send {
  background: var(--color-accent);
  color: var(--color-inverse);
}

.chat-input__btn--send:hover:not(:disabled) {
  background: var(--color-accent-strong);
  transform: scale(1.05);
}

.chat-input__btn--send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chat-input__btn--stop {
  background: #dc2626;
  color: #ffffff;
}

.chat-input__btn--stop:hover {
  background: #b91c1c;
  transform: scale(1.05);
}
</style>
