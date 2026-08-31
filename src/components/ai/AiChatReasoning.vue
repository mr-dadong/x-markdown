<template>
  <!-- 思考过程折叠块：无边框轻量样式，展开内容用左侧细线缩进 -->
  <div class="mb-2">
    <button
      type="button"
      class="flex cursor-pointer items-center gap-1 py-0.5 text-left text-[11px] text-muted hover:text-secondary"
      @mousedown.prevent="toggle"
    >
      <Icon :icon="expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'" :size="12" />
      <Icon icon="lucide:brain" :size="12" />
      <span>{{ title }}</span>
    </button>
    <div
      v-show="expanded"
      class="reasoning-scroll ml-1 mt-1 max-h-[220px] overflow-y-auto border-l-2 border-line pl-2.5 text-[11.5px] leading-relaxed text-muted"
    >
      <!-- 思考过程同样用 Markdown 渲染，避免 **加粗** 等语法以原始星号形式展示 -->
      <div class="reasoning-md" v-html="renderedContent" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import MarkdownIt from 'markdown-it'
import { normalizeAiMarkdown } from '../../utils/aiMarkdown'

const props = defineProps<{
  /** 思考过程文本（增量累积） */
  content: string
  /** 思考是否仍在进行中（流式输出时为 true） */
  streaming?: boolean
}>()

// 思考过程按 Markdown 渲染；html: false 会转义原始 HTML，保持安全
const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: true,
})

const renderedContent = computed(() =>
  props.content ? md.render(normalizeAiMarkdown(props.content)) : '',
)

const expanded = ref(!!props.streaming)

const title = computed(() => (props.streaming ? '思考中…' : '思考过程'))

// 流式期间默认展开，结束后自动收起，保持最终消息简洁
watch(
  () => props.streaming,
  (streaming) => {
    expanded.value = !!streaming
  },
)

const toggle = (): void => {
  expanded.value = !expanded.value
}
</script>

<style scoped>
/* 隐藏思考过程内容区的竖向滚动条，同时保留滚动能力 */
.reasoning-scroll {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.reasoning-scroll::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

/* 思考过程的 Markdown 排版（内容由 v-html 渲染，只能用深度选择器控制样式） */
.reasoning-md :deep(p) {
  margin: 0 0 6px;
}
.reasoning-md :deep(p:last-child) {
  margin-bottom: 0;
}
.reasoning-md :deep(ul),
.reasoning-md :deep(ol) {
  margin: 4px 0;
  padding-left: 18px;
}
.reasoning-md :deep(strong) {
  font-weight: 700;
  color: var(--color-secondary);
}
.reasoning-md :deep(code) {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 11px;
  background: var(--color-selected);
  padding: 0 3px;
  border-radius: 3px;
}
.reasoning-md :deep(a) {
  color: var(--color-secondary);
}
</style>
