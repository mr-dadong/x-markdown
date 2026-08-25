<template>
  <div class="chat-msg" :class="`chat-msg--${message.role}`">
    <!-- 用户消息 -->
    <div v-if="message.role === 'user'" class="chat-msg__bubble chat-msg__bubble--user">
      <div class="chat-msg__text">{{ message.content }}</div>
    </div>

    <!-- AI 回复 -->
    <div v-else-if="message.role === 'assistant'" class="chat-msg__bubble chat-msg__bubble--assistant">
      <div class="chat-msg__header">
        <span class="chat-msg__badge">
          <Icon icon="lucide:sparkles" :size="11" />
          <span>AI</span>
        </span>
      </div>
      <div class="chat-msg__content" v-html="renderedContent" />
      <AiChatMessageActions
        :message-id="message.id"
        :is-streaming="isStreaming"
        @insert="$emit('insert', message.id)"
        @replace="$emit('replace', message.id)"
        @copy="$emit('copy', message.id)"
        @retry="$emit('retry')"
      />
    </div>

    <!-- 系统消息 -->
    <div v-else-if="message.role === 'system'" class="chat-msg__bubble chat-msg__bubble--system">
      <Icon icon="lucide:info" :size="12" class="chat-msg__system-icon" />
      <span class="chat-msg__text">{{ message.content }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { AiChatMessage } from '../../types/ai'
import AiChatMessageActions from './AiChatMessageActions.vue'

const props = defineProps<{
  message: AiChatMessage
  isStreaming?: boolean
}>()

defineEmits<{
  insert: [messageId: string]
  replace: [messageId: string]
  copy: [messageId: string]
  retry: []
}>()

// 简单的 Markdown 渲染：代码块、行内代码、粗体、斜体、链接
const renderedContent = computed(() => {
  let html = escapeHtml(props.message.content)

  // 代码块 ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langLabel = lang ? `<span class="code-lang">${lang}</span>` : ''
    return `<div class="code-block-wrapper">${langLabel}<pre class="code-block"><code>${code}</code></pre></div>`
  })

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // 粗体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="chat-link">$1</a>')

  // 换行
  html = html.replace(/\n/g, '<br>')

  return html
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
</script>

<style scoped>
.chat-msg {
  display: flex;
  flex-direction: column;
  padding: 0 12px;
}

.chat-msg--user {
  align-items: flex-end;
}

.chat-msg--assistant,
.chat-msg--system {
  align-items: flex-start;
}

.chat-msg__bubble {
  max-width: 100%;
  border-radius: 10px;
  word-break: break-word;
}

.chat-msg__bubble--user {
  background: var(--color-accent);
  color: var(--color-inverse);
  padding: 8px 12px;
  border-radius: 10px 10px 2px 10px;
  max-width: 85%;
}

.chat-msg__bubble--assistant {
  background: var(--color-panel);
  border: 1px solid var(--color-line);
  padding: 10px 12px;
  border-radius: 10px 10px 10px 2px;
  width: 100%;
}

.chat-msg__bubble--system {
  background: transparent;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-muted);
}

.chat-msg__header {
  margin-bottom: 6px;
}

.chat-msg__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-accent);
  padding: 2px 6px;
  background: var(--color-selected);
  border-radius: 4px;
}

.chat-msg__text {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.chat-msg__content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-ink);
}

.chat-msg__content :deep(.code-block-wrapper) {
  position: relative;
  margin: 8px 0;
}

.chat-msg__content :deep(.code-lang) {
  position: absolute;
  top: 4px;
  right: 8px;
  font-size: 10px;
  color: var(--color-muted);
  text-transform: uppercase;
}

.chat-msg__content :deep(.code-block) {
  background: var(--color-paper);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.chat-msg__content :deep(.inline-code) {
  background: var(--color-selected);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
}

.chat-msg__content :deep(.chat-link) {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.chat-msg__content :deep(.chat-link:hover) {
  color: var(--color-accent-strong);
}

.chat-msg__system-icon {
  flex-shrink: 0;
  opacity: 0.6;
}
</style>
