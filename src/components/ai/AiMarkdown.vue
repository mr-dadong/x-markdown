<template>
  <!-- AI 对话的 Markdown 渲染器：统一 markdown-it 配置、代码块渲染、外链拦截与排版样式。
       既支持整段渲染（markdown prop），也支持流式分块渲染（默认插槽传入已完成块/尾段）。 -->
  <div class="ai-md markdown-body" @click="handleClick">
    <!-- 整段渲染：由本组件一次性 v-html 输出 -->
    <div v-if="markdown !== undefined" v-html="rendered" />
    <!-- 流式分块渲染：调用方通过 ref.render() 预渲染块后放入默认插槽 -->
    <slot v-else />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { normalizeAiMarkdown } from '../../utils/aiMarkdown'
import { windowService } from '../../services/windowService'

const props = defineProps<{
  /** 整段 Markdown 内容；缺省时使用默认插槽提供流式分块内容 */
  markdown?: string
}>()

// 初始化 markdown-it（整段渲染与流式分块共用同一实例，保证配置一致）
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
})

// 自定义代码块渲染：统一语言标签 + 代码围栏结构
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = token.info.trim()
  const langLabel = lang ? `<span class="code-lang">${lang}</span>` : ''
  const content = md.utils.escapeHtml(token.content)
  return `<div class="code-block-wrapper">${langLabel}<pre class="code-block"><code>${content}</code></pre></div>`
}

// 片段的 Markdown 归一化 + 渲染：供内部整段渲染与外部流式分块共用的唯一入口
const render = (text: string): string => md.render(normalizeAiMarkdown(text))

const rendered = computed(() => {
  if (!props.markdown) return ''
  // 先还原模型过度转义的 \*\* 等标记，再渲染，否则加粗等语法会以原始星号展示
  return render(props.markdown)
})

// 聊天内容里的外链统一交给系统默认应用，避免 Electron 窗口内意外导航；
// 通过事件委托同时覆盖整段 v-html 与流式分块两类渲染内容。
const handleClick = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null
  const anchor = target?.closest('a') as HTMLAnchorElement | null
  if (!anchor) return
  const href = anchor.getAttribute('href') ?? ''
  // 仅拦截 http/https/mailto；相对地址与 # 锚点在 Electron 内由 will-navigate 统一防护
  if (!/^(?:https?:|mailto:)/i.test(href)) return
  event.preventDefault()
  void windowService.openExternalLink(href)
}

defineExpose({ render })
</script>

<style scoped>
/* AI 对话 Markdown 正文排版（内容由 v-html 渲染，只能用深度选择器控制样式） */
.ai-md {
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-ink);
}

/* 流式分块渲染：块间间距由包裹层控制，最后一个块贴底不残留空隙 */
.ai-md :deep(.ai-md-block) {
  margin-bottom: 8px;
}

.ai-md :deep(.ai-md-block:last-child) {
  margin-bottom: 0;
}

/* 流式尾段：纯文本降级，保留换行与缩进，长串自动换行 */
.ai-md :deep(.ai-md-tail) {
  white-space: pre-wrap;
  word-break: break-word;
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
.ai-md :deep(h5) { font-size: 13px; }
.ai-md :deep(h6) { font-size: 12px; }

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