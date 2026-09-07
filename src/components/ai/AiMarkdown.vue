<template>
  <!-- AI 对话的 Markdown 渲染器：统一 markdown-it 配置、代码块渲染、外链拦截与排版样式。
       既支持整段渲染（markdown prop），也支持流式分块渲染（默认插槽传入已完成块/尾段）。
       尾段通过 renderTail() 预渲染成样式，未闭合的代码围栏单独降级为纯文本代码块。 -->
  <div class="ai-md markdown-body" @click="handleClick">
    <!-- 整段渲染：由本组件一次性 v-html 输出 -->
    <div v-if="markdown !== undefined" v-html="rendered" />
    <!-- 流式分块渲染：调用方通过 ref.render() / renderTail() 预渲染块后放入默认插槽 -->
    <slot v-else />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { extractUnclosedFence, normalizeAiMarkdown } from '../../utils/aiMarkdown'
import { windowService } from '../../services/windowService'
import { highlightCode } from '../../modules/codeBlockHighlight'
import { getCodeBlockStyle } from '../../modules/codeBlockStyles'
import { useSettings } from '../../composables/useSettings'

const props = defineProps<{
  /** 整段 Markdown 内容；缺省时使用默认插槽提供流式分块内容 */
  markdown?: string
}>()

const { settings } = useSettings()

// 初始化 markdown-it（整段渲染与流式分块共用同一实例，保证配置一致）
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
})

// 构造代码块 HTML：正常渲染（highlighted=true 走语法高亮）与流式尾段的未闭合围栏降级（highlighted=false 纯文本）共用。
// 颜色类名来自设置中的代码块外观，与编辑器代码块保持一致。
// data-wrap 标记当前是否自动换行（默认 1=换行），交给 CSS 决定排版，点击切换按钮时更新。
const makeFenceHtml = (lang: string, content: string, highlighted: boolean): string => {
  const style = getCodeBlockStyle(settings.codeBlockStyle)
  const langLabel = `<span class="code-lang">${md.utils.escapeHtml(lang)}</span>`
  const wrapButton = `<button type="button" title="关闭自动换行" class="code-wrap-btn is-active ${style.headerControlClass} ${style.headerHoverClass}">自动换行</button>`
  const copyButton = `<button type="button" class="code-copy-btn ${style.headerControlClass} ${style.headerHoverClass}">复制</button>`
  const code = highlighted ? highlightCode(lang, content) : md.utils.escapeHtml(content)
  return (
    `<div class="code-block-wrapper ${style.tokenClass}" data-wrap="1">` +
    `<div class="code-block-header ${style.headerClass} ${style.headerTextClass}">${langLabel}` +
    `<span class="code-header-actions">${wrapButton}${copyButton}</span></div>` +
    `<pre class="code-block ${style.preClass} ${style.codeClass}"><code>${code}</code></pre>` +
    `</div>`
  )
}

// 自定义代码块渲染：语言标签 + 自动换行开关 + 复制按钮 + 语法高亮。
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  return makeFenceHtml(token.info.trim(), token.content, true)
}

// 片段的 Markdown 归一化 + 渲染：供内部整段渲染与外部流式分块共用的唯一入口
const render = (text: string): string => md.render(normalizeAiMarkdown(text))

// 流式尾段（正在写入的最后一段）渲染：
// 普通内容直接按 markdown 渲染成样式，让进行中的段落也实时显示排版效果；
// 若处于未闭合的代码围栏内（``` 尚无配对闭合行），整段交给 markdown-it 会把代码行当成普通段落，
// 破坏换行与高亮，因此降级为不带语法高亮的等宽代码块，围栏一旦闭合即由分块逻辑收进已完成块。
const renderTail = (text: string): string => {
  const fence = extractUnclosedFence(text)
  if (fence) return makeFenceHtml(fence.lang, fence.body, false)
  return render(text)
}

const rendered = computed(() => {
  if (!props.markdown) return ''
  // 先还原模型过度转义的 \*\* 等标记，再渲染，否则加粗等语法会以原始星号展示；
  // 代码块外观设置变化时也一并重新渲染，让已有消息跟随设置。
  void settings.codeBlockStyle
  return render(props.markdown)
})

// 聊天内容里的外链统一交给系统默认应用，避免 Electron 窗口内意外导航；
// 通过事件委托同时覆盖整段 v-html 与流式分块两类渲染内容。
const handleClick = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null

  // 自动换行开关：在“自动换行/关闭换行”之间切换，并把高亮状态同步到按钮上。
  // 状态写在 wrapper 的 data-wrap 上，CSS 据此切换代码块排版；重新渲染/刷新后默认回到自动换行。
  const wrapButton = target?.closest('.code-wrap-btn') as HTMLButtonElement | null
  if (wrapButton) {
    const wrapper = wrapButton.closest('.code-block-wrapper') as HTMLElement | null
    if (!wrapper) return
    const isWrapped = wrapper.dataset.wrap === '1'
    // 切换后新的换行状态与按钮文案一致：开启=显示“关闭换行”，关闭=显示“自动换行”
    const nowWrapped = !isWrapped
    wrapper.dataset.wrap = nowWrapped ? '1' : '0'
    // 高亮状态跟随当前是否换行，方便一眼看出代码块当前是否自动换行
    wrapButton.classList.toggle('is-active', nowWrapped)
    wrapButton.textContent = nowWrapped ? '关闭换行' : '自动换行'
    wrapButton.title = nowWrapped ? '关闭自动换行' : '开启自动换行'
    return
  }

  // 代码块右上角复制按钮：把对应代码块的正文写入剪贴板，并短暂提示复制成功。
  // 模型输出的代码块常在围栏后多一个空行（正文以换行开头），若原样粘贴会多出一个空行；
  // 这里去掉首尾的整行空白，只保留有效代码行，兼顾缩进不变与内部换行。
  const copyButton = target?.closest('.code-copy-btn') as HTMLButtonElement | null
  if (copyButton) {
    const wrapper = copyButton.closest('.code-block-wrapper') as HTMLElement | null
    const codeElement = wrapper?.querySelector('pre.code-block code') as HTMLElement | null
    if (codeElement) {
      // 去除开头的整行空白（如模型在首行前多出的空行）与末尾的换行，中间内容原样保留
      const codeText = (codeElement.textContent ?? '')
        .replace(/^\s*\n/, '')
        .replace(/\n\s*$/, '')
      void navigator.clipboard.writeText(codeText)
      copyButton.textContent = '已复制'
      window.setTimeout(() => {
        copyButton.textContent = '复制'
      }, 1500)
    }
    return
  }

  const anchor = target?.closest('a') as HTMLAnchorElement | null
  if (!anchor) return
  const href = anchor.getAttribute('href') ?? ''
  // 仅拦截 http/https/mailto；相对地址与 # 锚点在 Electron 内由 will-navigate 统一防护
  if (!/^(?:https?:|mailto:)/i.test(href)) return
  event.preventDefault()
  void windowService.openExternalLink(href)
}

defineExpose({ render, renderTail })
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

/* 流式尾段：进行中内容已渲染成样式，作为最后一块贴底不残留空隙 */
.ai-md :deep(.ai-md-tail) :deep(> :last-child) {
  margin-bottom: 0;
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
  margin: 10px 0;
}

/* 代码块头部：语言标签居左、复制按钮居右 */
.ai-md :deep(.code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-width: 1px 1px 0;
  border-style: solid;
  border-radius: 8px 8px 0 0;
  padding: 5px 10px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 10px;
}

.ai-md :deep(.code-lang) {
  text-transform: uppercase;
}

/* 头部右侧动作区：自动换行开关 + 复制按钮，保持横向排列不换行 */
.ai-md :deep(.code-header-actions) {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 自动换行开关与复制按钮共用一套控件外观：底色/悬停由代码块外观的控件类提供 */
.ai-md :deep(.code-wrap-btn),
.ai-md :deep(.code-copy-btn) {
  border: 0;
  background: transparent;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 10px;
  cursor: pointer;
}

/* 自动换行开启时的高亮状态：半透明底色在浅/深色头部上都能清晰辨认 */
.ai-md :deep(.code-wrap-btn.is-active) {
  background: rgba(127, 127, 127, 0.22);
}

/* 代码块正文：默认自动换行（data-wrap=1）时折行显示；关闭换行时保留整行横向滚动 */
.ai-md :deep(.code-block-wrapper[data-wrap='1'] .code-block) {
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-md :deep(.code-block-wrapper[data-wrap='0'] .code-block) {
  white-space: pre;
  overflow-x: auto;
}

.ai-md :deep(.code-block) {
  background: var(--color-paper);
  border-width: 0 1px 1px;
  border-style: solid;
  border-radius: 0 0 8px 8px;
  padding: 12px 14px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.6;
  tab-size: 2;
}

/* 关闭自动换行、出现横向滚动时的滚动条：细窄圆角滑块。
   与编辑器全局滚动条保持一致：thumb 用透明边框 + background-clip 收紧出内边距，
   视觉上更轻盈，避免默认粗壮实心条破坏代码块观感。 */
.ai-md :deep(.code-block) {
  scrollbar-width: thin;
  scrollbar-color: var(--color-scrollbar) transparent;
}

.ai-md :deep(.code-block::-webkit-scrollbar) {
  height: 8px;
}

.ai-md :deep(.code-block::-webkit-scrollbar-track) {
  background: transparent;
}

.ai-md :deep(.code-block::-webkit-scrollbar-thumb) {
  min-width: 32px;
  border: 2px solid transparent;
  border-radius: 9999px;
  background-color: var(--color-scrollbar);
  background-clip: content-box;
}

.ai-md :deep(.code-block::-webkit-scrollbar-thumb:hover) {
  background-color: var(--color-scrollbar-hover);
}

.ai-md :deep(.code-block::-webkit-scrollbar-corner) {
  background: transparent;
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