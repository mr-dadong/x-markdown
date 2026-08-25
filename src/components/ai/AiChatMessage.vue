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
      <div class="chat-msg__content markdown-body" v-html="renderedContent" />
      <AiChatMessageActions
        :message-id="message.id"
        :is-streaming="isStreaming"
        @insert="$emit('insert', message.id)"
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
import MarkdownIt from 'markdown-it'
import type { AiChatMessage } from '../../types/ai'
import AiChatMessageActions from './AiChatMessageActions.vue'

const props = defineProps<{
  message: AiChatMessage
  isStreaming?: boolean
}>()

defineEmits<{
  insert: [messageId: string]
  copy: [messageId: string]
  retry: []
}>()

// 初始化 markdown-it
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
})

// 自定义代码块渲染
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = token.info.trim()
  const langLabel = lang ? `<span class="code-lang">${lang}</span>` : ''
  const content = md.utils.escapeHtml(token.content)
  return `<div class="code-block-wrapper">${langLabel}<pre class="code-block"><code>${content}</code></pre></div>`
}

const renderedContent = computed(() => {
  if (!props.message.content) return ''
  return md.render(props.message.content)
})
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

.chat-msg__system-icon {
  flex-shrink: 0;
  opacity: 0.6;
}

/* Markdown 渲染样式 */
.chat-msg__content.markdown-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-ink);
}

/* 标题 */
.chat-msg__content :deep(h1),
.chat-msg__content :deep(h2),
.chat-msg__content :deep(h3),
.chat-msg__content :deep(h4),
.chat-msg__content :deep(h5),
.chat-msg__content :deep(h6) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
  line-height: 1.4;
}

.chat-msg__content :deep(h1) { font-size: 18px; }
.chat-msg__content :deep(h2) { font-size: 16px; }
.chat-msg__content :deep(h3) { font-size: 14px; }
.chat-msg__content :deep(h4) { font-size: 13px; }

.chat-msg__content :deep(h1:first-child),
.chat-msg__content :deep(h2:first-child),
.chat-msg__content :deep(h3:first-child) {
  margin-top: 0;
}

/* 段落 */
.chat-msg__content :deep(p) {
  margin: 0 0 10px;
}

.chat-msg__content :deep(p:last-child) {
  margin-bottom: 0;
}

/* 列表 */
.chat-msg__content :deep(ul),
.chat-msg__content :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.chat-msg__content :deep(li) {
  margin: 4px 0;
}

.chat-msg__content :deep(li > ul),
.chat-msg__content :deep(li > ol) {
  margin: 2px 0;
}

/* 代码块 */
.chat-msg__content :deep(.code-block-wrapper) {
  position: relative;
  margin: 10px 0;
}

.chat-msg__content :deep(.code-lang) {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 10px;
  color: var(--color-muted);
  text-transform: uppercase;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  z-index: 1;
}

.chat-msg__content :deep(.code-block) {
  background: var(--color-paper);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.6;
  tab-size: 2;
}

.chat-msg__content :deep(code) {
  background: var(--color-selected);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
}

.chat-msg__content :deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
}

/* 引用块 */
.chat-msg__content :deep(blockquote) {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--color-accent);
  background: var(--color-selected);
  border-radius: 0 6px 6px 0;
  color: var(--color-secondary);
}

.chat-msg__content :deep(blockquote p) {
  margin: 0;
}

/* 链接 */
.chat-msg__content :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.chat-msg__content :deep(a:hover) {
  color: var(--color-accent-strong);
}

/* 表格 */
.chat-msg__content :deep(table) {
  border-collapse: collapse;
  margin: 10px 0;
  width: 100%;
  font-size: 12px;
}

.chat-msg__content :deep(th),
.chat-msg__content :deep(td) {
  border: 1px solid var(--color-line);
  padding: 6px 10px;
  text-align: left;
}

.chat-msg__content :deep(th) {
  background: var(--color-selected);
  font-weight: 600;
}

.chat-msg__content :deep(tr:nth-child(even)) {
  background: var(--color-panel);
}

/* 分割线 */
.chat-msg__content :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-line);
  margin: 16px 0;
}

/* 图片 */
.chat-msg__content :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}

/* 强调 */
.chat-msg__content :deep(strong) {
  font-weight: 600;
}

.chat-msg__content :deep(em) {
  font-style: italic;
}

/* 删除线 */
.chat-msg__content :deep(del) {
  text-decoration: line-through;
  color: var(--color-muted);
}
</style>
