<template>
  <NodeViewWrapper class="relative my-4 flex w-full flex-col" data-xmd-html-view>
    <div class="flex w-full flex-col overflow-hidden rounded-md border bg-paper"
      :class="editing || props.selected ? 'border-accent' : 'border-line'" contenteditable="false">
      <!-- 常驻的模块身份与编辑入口，让用户无需试探就能发现 HTML 预览可以继续编辑。 -->
      <button type="button"
        class="flex h-9 w-full items-center justify-between border-b border-line bg-toolbar px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        title="编辑 HTML 源码" @click.stop="startEditing">
        <span class="flex items-center gap-2 text-[11px] font-semibold text-secondary">
          <Icon icon="lucide:file-code-2" :size="14" class="text-danger" />
          <span>HTML 预览</span>
        </span>
        <span class="flex items-center gap-1.5 text-[11px] text-muted">
          <span>{{ editing ? '正在编辑源码' : '点击编辑源码' }}</span>
          <Icon icon="lucide:pencil" :size="13" />
        </span>
      </button>

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
const lineNumbers = computed(() => Array.from({ length: draft.value.split('\n').length }, (_, index) => index + 1))
// 少量源码按实际行数收紧高度，较长源码达到上限后在窗口内部滚动。
const sourceEditorStyle = computed(() => ({
  height: `${Math.min(280, Math.max(96, lineNumbers.value.length * 20 + 24))}px`,
}))
// 原始字符串仍单独保存在节点属性中；预览文档会过滤危险标签并隔离用户 CSS。
const previewDocument = computed(() => createHtmlPreviewDocument(source.value))
const hasVisiblePreview = computed(() => source.value.trim().length > 0)
const previewFrameStyle = computed(() => ({ height: `${previewHeight.value}px` }))

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

// HTML 仍经过 DOMPurify 过滤后展示；源码输入则立即同步到当前文档节点。
watch(draft, (value) => {
  if (!editing.value || value === source.value) return
  props.updateAttributes({ source: value })
})

onBeforeUnmount(disconnectPreviewObserver)
</script>
