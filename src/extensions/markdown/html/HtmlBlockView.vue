<template>
  <NodeViewWrapper class="relative my-4 flex w-full flex-col" data-xmd-html-view>
    <div class="flex w-full flex-col overflow-hidden rounded-md border bg-paper"
      :class="editing || props.selected ? 'border-accent' : 'border-line'" contenteditable="false">
      <!-- 常驻的模块身份与编辑入口，让用户无需试探就能发现 HTML 预览可以继续编辑。 -->
      <div
        class="flex h-9 w-full items-center justify-between gap-2 border-b border-line bg-toolbar px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent">
        <button type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          title="编辑 HTML 源码" @click.stop="startEditing">
          <span class="flex items-center gap-2 text-[11px] font-semibold text-secondary">
            <Icon icon="lucide:file-code-2" :size="14" class="text-danger" />
            <span>HTML 预览</span>
          </span>
        </button>
        <span class="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
          <span>{{ editing ? '正在编辑源码' : '点击编辑源码' }}</span>
          <button type="button" title="编辑 HTML 源码"
            class="flex h-6 w-6 items-center justify-center rounded hover:bg-line hover:text-secondary"
            @click.stop="startEditing">
            <Icon icon="lucide:pencil" :size="13" />
          </button>
          <button type="button" title="放大预览"
            class="flex h-6 w-6 items-center justify-center rounded hover:bg-line hover:text-secondary"
            @click.stop="openPreviewModal">
            <Icon icon="lucide:maximize-2" :size="14" />
          </button>
        </span>
      </div>

      <div class="relative flex min-h-14 w-full cursor-text px-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        role="button" tabindex="0" title="点击编辑 HTML 源码" @click.stop="startEditing"
        @keydown.enter.prevent.stop="startEditing" @keydown.space.prevent.stop="startEditing">
        <!-- iframe 隔离每个块的 CSS；禁用指针事件后，点击仍由外层统一进入源码编辑。 -->
        <iframe v-if="hasVisiblePreview" ref="previewFrame" :srcdoc="previewDocument"
          sandbox="allow-same-origin" tabindex="-1" title="HTML 隔离预览"
          class="pointer-events-none flex w-full border-0 bg-transparent" :style="previewFrameStyle"
          @load="handlePreviewLoad" />
        <div v-else class="flex flex-1 items-center justify-center text-[12px] text-muted">
          这段 HTML 没有可见内容，点击编辑源码
        </div>
      </div>
    </div>

    <MarkdownModulePopover v-if="editing" :width="560" full-width @cancel="cancelEditing" @submit="saveEditing">
      <div class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#3d3f45] bg-[#1e1f22]">
        <div class="flex h-9 shrink-0 items-center justify-between border-b border-[#3d3f45] bg-[#292a2e] px-3">
          <span class="flex items-center gap-3">
            <span class="flex items-center gap-1.5">
              <span class="flex h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span class="flex h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span class="flex h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </span>
            <span class="font-mono text-[10px] font-medium uppercase tracking-wider text-[#bec1c7]">HTML</span>
          </span>
          <button type="button" :title="lineWrapping ? '关闭自动换行' : '开启自动换行'"
            class="flex h-6 items-center justify-center gap-1 rounded px-2 font-mono text-[10px] text-[#969aa3] hover:bg-[#3a3b40] hover:text-[#e4e6eb]"
            :class="lineWrapping ? 'bg-[#45464c] text-[#e4e6eb]' : ''" @mousedown.prevent="lineWrapping = !lineWrapping">
            <Icon icon="lucide:wrap-text" :size="13" />
            <span>换行</span>
          </button>
        </div>
        <HtmlSourceEditor v-model="draft" :line-wrapping="lineWrapping" :style="sourceEditorStyle" @submit="saveEditing" />
      </div>
    </MarkdownModulePopover>

    <!-- 放大预览：全屏蒙层，内容保留真实宽度，超高/超宽时在蒙层内滚动。 -->
    <Teleport to="body">
      <div v-if="previewOpen" ref="previewModalRoot" tabindex="-1"
        class="fixed inset-0 z-[160] flex flex-col bg-black/45 p-6 outline-none"
        role="dialog" aria-modal="true" aria-label="HTML 放大预览"
        @mousedown.self="closePreviewModal" @keydown.esc.prevent="closePreviewModal">
        <div class="mb-4 flex shrink-0 items-center justify-between">
          <span class="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <span class="flex h-7 w-7 items-center justify-center rounded-md bg-panel text-muted">
              <Icon icon="lucide:maximize-2" :size="15" />
            </span>
            <span>HTML 放大预览</span>
          </span>
          <div class="flex items-center gap-1">
            <button type="button"
              class="flex h-7 items-center gap-1.5 rounded-md border border-line bg-paper px-2 text-[12px] text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              @click="openInNewWindow">
              <Icon icon="lucide:external-link" :size="13" />
              <span>在新窗口打开</span>
            </button>
            <button type="button" title="关闭"
              class="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-paper text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              @click="closePreviewModal">
              <Icon icon="lucide:x" :size="15" />
            </button>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-paper">
          <iframe v-if="hasVisiblePreview" ref="previewModalFrame" :srcdoc="previewDocument"
            sandbox="allow-same-origin" title="HTML 放大预览"
            class="block w-full border-0 bg-transparent" :style="previewModalFrameStyle"
            @load="handlePreviewModalLoad" />
        </div>
      </div>
    </Teleport>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import HtmlSourceEditor from './HtmlSourceEditor.vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import { createHtmlPreviewDocument } from './htmlPreview'

const props = defineProps<NodeViewProps>()

const editing = ref(false)
const lineWrapping = ref(false)
const source = computed(() => String(props.node.attrs.source))
const draft = ref(source.value)
const sourceBeforeEditing = ref(source.value)
const previewFrame = ref<HTMLIFrameElement | null>(null)
const previewHeight = ref(56)
let previewResizeObserver: ResizeObserver | null = null

// 放大预览状态：复用同样的预览文档，但允许在蒙层内自由滚动并保留内容真实宽度。
const previewOpen = ref(false)
const previewModalRoot = ref<HTMLDivElement | null>(null)
const previewModalFrame = ref<HTMLIFrameElement | null>(null)
const previewModalHeight = ref(56)
let previewModalResizeObserver: ResizeObserver | null = null
const lineNumbers = computed(() => Array.from({ length: draft.value.split('\n').length }, (_, index) => index + 1))
// 少量源码按实际行数收紧高度，较长源码达到上限后在窗口内部滚动。
const sourceEditorStyle = computed(() => ({
  height: `${Math.min(280, Math.max(96, lineNumbers.value.length * 20 + 24))}px`,
}))
// 原始字符串仍单独保存在节点属性中；预览文档会过滤危险标签并隔离用户 CSS。
const previewDocument = computed(() => createHtmlPreviewDocument(source.value))
const hasVisiblePreview = computed(() => source.value.trim().length > 0)
const previewFrameStyle = computed(() => ({ height: `${previewHeight.value}px` }))
const previewModalFrameStyle = computed(() => ({ height: `${previewModalHeight.value}px` }))

const disconnectPreviewObserver = (): void => {
  previewResizeObserver?.disconnect()
  previewResizeObserver = null
}

const updatePreviewHeight = (): void => {
  const frameDocument = previewFrame.value?.contentDocument
  if (!frameDocument) return
  const bodyHeight = frameDocument.body?.scrollHeight ?? 0
  const documentHeight = frameDocument.documentElement?.scrollHeight ?? 0
  previewHeight.value = Math.max(32, bodyHeight, documentHeight)
}

const handlePreviewLoad = (): void => {
  disconnectPreviewObserver()
  const frameDocument = previewFrame.value?.contentDocument
  if (!frameDocument?.body) return

  updatePreviewHeight()
  // 图片、字体和布局变化后同步调整 iframe 高度，避免预览内部出现滚动条。
  const observer = new ResizeObserver(updatePreviewHeight)
  previewResizeObserver = observer
  observer.observe(frameDocument.body)
  observer.observe(frameDocument.documentElement)
}

const disconnectPreviewModalObserver = (): void => {
  previewModalResizeObserver?.disconnect()
  previewModalResizeObserver = null
}

const updatePreviewModalHeight = (): void => {
  const frameDocument = previewModalFrame.value?.contentDocument
  if (!frameDocument) return
  const bodyHeight = frameDocument.body?.scrollHeight ?? 0
  const documentHeight = frameDocument.documentElement?.scrollHeight ?? 0
  previewModalHeight.value = Math.max(32, bodyHeight, documentHeight)
}

const handlePreviewModalLoad = (): void => {
  disconnectPreviewModalObserver()
  const frameDocument = previewModalFrame.value?.contentDocument
  if (!frameDocument?.body) return

  updatePreviewModalHeight()
  // 放大预览走高的方式：iframe 撑到内容真实高度，纵向滚动交给外层蒙层容器。
  const observer = new ResizeObserver(updatePreviewModalHeight)
  previewModalResizeObserver = observer
  observer.observe(frameDocument.body)
  observer.observe(frameDocument.documentElement)
}

const openPreviewModal = (): void => {
  if (previewOpen.value) return
  previewOpen.value = true
  previewModalHeight.value = 56
  // 聚焦到蒙层根节点，让 Esc 与键盘事件可用；容器跟随内容高度后用户即可上下滚动。
  void nextTick(() => previewModalRoot.value?.focus())
}

const closePreviewModal = (): void => {
  if (!previewOpen.value) return
  previewOpen.value = false
  disconnectPreviewModalObserver()
  // 关闭后把焦点还给主编辑区（TipTap 的内容可编辑根节点），避免键盘事件残留。
  const editorRoot = document.querySelector('.ProseMirror')
  if (editorRoot instanceof HTMLElement) editorRoot.focus()
}

// 在新窗口打开一份只读自包含 HTML：不开放脚本/表单，仅用于查看渲染效果。
const openInNewWindow = (): void => {
  if (!hasVisiblePreview.value) return
  // 同时带上有内容的 body 和用户自身的 style 块，保证新窗口渲染样式与预览一致。
  const bodyMatch = previewDocument.value.match(/<body>([\s\S]*)<\/body>/)
  const userCssMatch = previewDocument.value.match(/<style data-xmd-user-css>([\s\S]*?)<\/style>/)
  const safeContent = bodyMatch?.[1] ?? ''
  const userCss = userCssMatch?.[1] ?? ''
  const doc = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'">
<style>
  html { color-scheme: light dark; background: #ffffff; }
  body { padding: 24px; margin: 0; color: light-dark(#252525, #e4e6eb); background: transparent; }
</style>
<style>${userCss}</style>
</head>
<body>${safeContent}</body>
</html>`
  const blob = new Blob([doc], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  // 新窗口打开后等一小段时间再释放 URL，避免导航前被回收。
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const startEditing = (): void => {
  if (editing.value) return
  sourceBeforeEditing.value = source.value
  draft.value = source.value
  editing.value = true
}

const cancelEditing = (): void => {
  editing.value = false
  // 实时预览期间取消编辑，需要恢复打开弹窗之前的 HTML 源码。
  props.updateAttributes({ source: sourceBeforeEditing.value })
  draft.value = sourceBeforeEditing.value
}

const saveEditing = (): void => {
  editing.value = false
}

watch(source, (value) => {
  draft.value = value
  previewHeight.value = 56
  disconnectPreviewObserver()
  void nextTick(updatePreviewHeight)
})

// 编辑期间源码变化，放大预览使用同一个 previewDocument，随节点属性实时刷新。
watch(draft, (value) => {
  if (!editing.value || value === source.value) return
  props.updateAttributes({ source: value })
})

onBeforeUnmount(() => {
  disconnectPreviewObserver()
  disconnectPreviewModalObserver()
})
</script>
