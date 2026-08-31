<template>
  <!-- 消息行：用户消息右对齐，AI 与系统消息左对齐 -->
  <div class="flex flex-col px-3" :class="message.role === 'user' ? 'items-end' : 'items-start'">
    <!-- 用户消息：实心深色气泡，右下角留小圆角模拟消息指向 -->
    <div v-if="message.role === 'user'" class="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2">
      <div class="whitespace-pre-wrap text-[13px] leading-relaxed text-inverse">{{ message.content }}</div>
    </div>

    <!-- AI 回复：柔和灰底无边框气泡，内容更轻 -->
    <div v-else-if="message.role === 'assistant'" class="w-full rounded-2xl rounded-bl-md bg-toolbar px-3.5 py-2.5">
      <!-- AI 小标识：仅用图标加文字，避免灰块徽章的笨重感 -->
      <div class="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted">
        <Icon icon="lucide:sparkles" :size="12" class="text-accent" />
        <span>AI</span>
      </div>
      <AiChatReasoning v-if="message.reasoning" :content="message.reasoning" />
      <div class="ai-md markdown-body" v-html="renderedContent" />
      <AiChatMessageActions
        :message-id="message.id"
        :is-streaming="isStreaming"
        @insert="$emit('insert', message.id)"
        @copy="$emit('copy', message.id)"
        @retry="$emit('retry')"
      />
    </div>

    <!-- 系统消息：居中的弱化提示行 -->
    <div
      v-else-if="message.role === 'system'"
      class="flex w-full items-center justify-center gap-1.5 py-1 text-[11px] text-muted"
    >
      <Icon icon="lucide:info" :size="12" class="shrink-0 opacity-60" />
      <span>{{ message.content }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import MarkdownIt from 'markdown-it'
import { normalizeAiMarkdown } from '../../utils/aiMarkdown'
import type { AiChatMessage } from '../../types/ai'
import AiChatMessageActions from './AiChatMessageActions.vue'
import AiChatReasoning from './AiChatReasoning.vue'

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
  // 先还原模型过度转义的 \*\* 等标记，再渲染，否则加粗等语法会以原始星号展示
  return md.render(normalizeAiMarkdown(props.message.content))
})
</script>

<style scoped>
/* AI 回复里的 Markdown 正文排版（内容由 v-html 渲染，只能用深度选择器控制样式） */
.ai-md {
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-ink);
}

/* 标题 */
.ai-md :deep(h1),
.ai-md :deep(h2),
.ai-md :deep(h3),
.ai-md :deep(h4),
.ai-md :deep(h5),
.ai-md :deep(h6) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 600;
  line-height: 1.4;
}

.ai-md :deep(h1) { font-size: 18px; }
.ai-md :deep(h2) { font-size: 16px; }
.ai-md :deep(h3) { font-size: 14px; }
.ai-md :deep(h4) { font-size: 13px; }

.ai-md :deep(h1:first-child),
.ai-md :deep(h2:first-child),
.ai-md :deep(h3:first-child) {
  margin-top: 0;
}

/* 段落 */
.ai-md :deep(p) {
  margin: 0 0 10px;
}

.ai-md :deep(p:last-child) {
  margin-bottom: 0;
}

/* 列表 */
.ai-md :deep(ul),
.ai-md :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.ai-md :deep(li) {
  margin: 4px 0;
}

.ai-md :deep(li > ul),
.ai-md :deep(li > ol) {
  margin: 2px 0;
}

/* 代码块 */
.ai-md :deep(.code-block-wrapper) {
  position: relative;
  margin: 10px 0;
}

.ai-md :deep(.code-lang) {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 10px;
  color: var(--color-muted);
  text-transform: uppercase;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  z-index: 1;
}

.ai-md :deep(.code-block) {
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

.ai-md :deep(code) {
  background: var(--color-selected);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
}

.ai-md :deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
}

/* 引用块 */
.ai-md :deep(blockquote) {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--color-accent);
  background: var(--color-selected);
  border-radius: 0 6px 6px 0;
  color: var(--color-secondary);
}

.ai-md :deep(blockquote p) {
  margin: 0;
}

/* 链接 */
.ai-md :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ai-md :deep(a:hover) {
  color: var(--color-accent-strong);
}

/* 表格 */
.ai-md :deep(table) {
  border-collapse: collapse;
  margin: 10px 0;
  width: 100%;
  font-size: 12px;
}

.ai-md :deep(th),
.ai-md :deep(td) {
  border: 1px solid var(--color-line);
  padding: 6px 10px;
  text-align: left;
}

.ai-md :deep(th) {
  background: var(--color-selected);
  font-weight: 600;
}

.ai-md :deep(tr:nth-child(even)) {
  background: var(--color-panel);
}

/* 分割线 */
.ai-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-line);
  margin: 16px 0;
}

/* 图片 */
.ai-md :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}

/* 强调 */
.ai-md :deep(strong) {
  font-weight: 600;
}

.ai-md :deep(em) {
  font-style: italic;
}

/* 删除线 */
.ai-md :deep(del) {
  text-decoration: line-through;
  color: var(--color-muted);
}
</style>
