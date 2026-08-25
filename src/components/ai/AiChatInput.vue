<template>
  <div class="chat-input">
    <!-- 快捷动作 -->
    <div class="chat-input__actions">
      <button
        v-for="action in quickActions"
        :key="action.id"
        type="button"
        class="chat-input__action-btn"
        :title="action.label"
        :disabled="isStreaming"
        @mousedown.prevent="handleQuickAction(action)"
      >
        <Icon :icon="action.icon" :size="12" />
        <span>{{ action.label }}</span>
      </button>
    </div>

    <!-- 输入区域 -->
    <div class="chat-input__wrapper">
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

    <!-- 上下文提示 -->
    <div v-if="hasContext" class="chat-input__context">
      <Icon icon="lucide:file-text" :size="11" />
      <span>{{ contextLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Icon } from '@iconify/vue/offline'

interface QuickAction {
  id: string
  label: string
  icon: string
  prompt: string
}

const props = defineProps<{
  isStreaming: boolean
  hasDocument: boolean
  hasSelection: boolean
}>()

const emit = defineEmits<{
  send: [content: string]
  cancel: []
}>()

const inputRef = ref<HTMLTextAreaElement | null>(null)
const inputText = ref('')

const canSend = computed(() => inputText.value.trim().length > 0 && !props.isStreaming)

const placeholder = computed(() => {
  if (props.isStreaming) return '正在生成…'
  return '输入消息，或使用 @文档 @选区 引用上下文…'
})

const contextLabel = computed(() => {
  if (props.hasSelection) return '已识别选区'
  if (props.hasDocument) return '已识别文档'
  return ''
})

const hasContext = computed(() => props.hasDocument || props.hasSelection)

const quickActions: QuickAction[] = [
  { id: 'summarize', label: '总结', icon: 'lucide:list', prompt: '请总结当前文档的主要内容' },
  { id: 'outline', label: '大纲', icon: 'lucide:list-tree', prompt: '请根据当前文档生成标题大纲' },
  { id: 'translate', label: '翻译', icon: 'lucide:pen-line', prompt: '请将选中的内容翻译为英文' },
  { id: 'explain', label: '解释', icon: 'lucide:code-2', prompt: '请解释这段代码的含义' },
]

const handleQuickAction = (action: QuickAction): void => {
  inputText.value = action.prompt
  nextTick(() => {
    inputRef.value?.focus()
    autoResize()
  })
}

const handleSend = (): void => {
  if (!canSend.value) return
  emit('send', inputText.value)
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
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
}

const focus = (): void => {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<style scoped>
.chat-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--color-line);
  background: var(--color-paper);
}

.chat-input__actions {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.chat-input__actions::-webkit-scrollbar {
  display: none;
}

.chat-input__action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--color-line);
  background: var(--color-panel);
  color: var(--color-secondary);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.chat-input__action-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-selected);
}

.chat-input__action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-input__wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--color-panel);
  border: 1px solid var(--color-line);
  border-radius: 10px;
  padding: 8px 8px 8px 12px;
  transition: border-color 0.15s ease;
}

.chat-input__wrapper:focus-within {
  border-color: var(--color-accent);
}

.chat-input__textarea {
  flex: 1;
  min-height: 20px;
  max-height: 120px;
  border: none;
  background: transparent;
  color: var(--color-ink);
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
  font-family: inherit;
}

.chat-input__textarea::placeholder {
  color: var(--color-muted);
}

.chat-input__textarea:disabled {
  opacity: 0.6;
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
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.chat-input__btn--send {
  background: var(--color-accent);
  color: var(--color-inverse);
}

.chat-input__btn--send:hover:not(:disabled) {
  background: var(--color-accent-strong);
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
}

.chat-input__context {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-muted);
  padding: 0 2px;
}
</style>
