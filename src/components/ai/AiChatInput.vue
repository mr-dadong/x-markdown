<template>
  <div class="chat-input">
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
          v-if="hasSelection"
          type="button"
          class="chat-input__btn chat-input__btn--selection"
          title="添加选区内容"
          @mousedown.prevent="addSelection"
        >
          <Icon icon="lucide:text-select" :size="14" />
        </button>
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
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Icon } from '@iconify/vue/offline'

const props = defineProps<{
  isStreaming: boolean
  getSelection: () => string
}>()

const emit = defineEmits<{
  send: [content: string]
  cancel: []
}>()

const inputRef = ref<HTMLTextAreaElement | null>(null)
const inputText = ref('')

const canSend = computed(() => inputText.value.trim().length > 0 && !props.isStreaming)

const hasSelection = computed(() => {
  const selection = props.getSelection()
  return selection && selection.trim().length > 0
})

const placeholder = computed(() => {
  if (props.isStreaming) return '正在生成…'
  return '输入消息…'
})

const addSelection = (): void => {
  const selection = props.getSelection()
  if (!selection || !selection.trim()) return
  
  // 将选区内容添加到输入框
  if (inputText.value.trim()) {
    inputText.value += '\n\n' + selection
  } else {
    inputText.value = selection
  }
  
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
  // 重置高度以获取正确的 scrollHeight
  textarea.style.height = '22px'
  // 如果内容超过一行，自动扩展
  if (textarea.scrollHeight > 22) {
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    textarea.style.overflowY = 'auto'
  } else {
    textarea.style.overflowY = 'hidden'
  }
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

.chat-input__wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--color-panel);
  border: 1px solid var(--color-line);
  border-radius: 20px;
  padding: 6px 6px 6px 14px;
  transition: border-color 0.15s ease;
}

.chat-input__wrapper:focus-within {
  border-color: var(--color-accent);
}

.chat-input__textarea {
  flex: 1;
  height: 22px;
  min-height: 22px;
  max-height: 120px;
  border: none;
  background: transparent;
  color: var(--color-ink);
  font-size: 13px;
  line-height: 22px;
  resize: none;
  outline: none;
  font-family: inherit;
  padding: 0;
  overflow-y: hidden;
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
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.chat-input__btn--selection {
  background: var(--color-selected);
  color: var(--color-accent);
}

.chat-input__btn--selection:hover {
  background: var(--color-accent);
  color: var(--color-inverse);
  transform: scale(1.05);
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
