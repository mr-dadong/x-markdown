<template>
  <NodeViewWrapper class="relative my-5 flex w-full" data-xmd-mermaid-view>
    <div ref="anchorElement" class="relative flex min-h-20 w-full" contenteditable="false"
      title="双击编辑图表" @dblclick.stop="startEditing">
      <div v-if="rendering" class="flex min-h-20 w-full items-center justify-center text-[12px] text-muted">
        正在渲染图表…
      </div>
      <div v-else-if="renderError"
        class="flex min-h-20 w-full flex-col justify-center gap-1 rounded-md border border-danger/40 px-4 py-3">
        <span class="text-[13px] font-medium text-danger">图表语法有误</span>
        <span class="font-mono text-[11px] leading-5 text-secondary">{{ renderError }}</span>
      </div>
      <div v-else class="flex min-h-20 w-full items-center justify-center overflow-x-auto px-2 py-3"
        v-html="diagramHtml" />

      <button v-if="props.selected && !editing" type="button" title="编辑 Mermaid 源码"
        class="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @click.stop="startEditing">
        <Icon icon="lucide:pen-line" :size="14" />
      </button>
    </div>

    <MarkdownModulePopover v-if="editing" title="编辑 Mermaid 图表" description="修改源码后保存并重新渲染"
      icon="lucide:code-2" :position="popoverPosition" :width="500" @cancel="cancelEditing" @submit="saveEditing">
      <div class="flex flex-col">
        <div class="flex h-9 items-center justify-between border-b border-line px-3.5">
          <span class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-secondary">
            <Icon icon="lucide:code-2" :size="13" />
            Mermaid
          </span>
          <span class="font-mono text-[9px] text-muted">UTF-8</span>
        </div>
        <label class="flex min-h-40 bg-paper focus-within:bg-paper">
          <span class="flex w-10 shrink-0 select-none flex-col items-end border-r border-line bg-toolbar px-2 py-3 font-mono text-[11px] leading-5 text-muted/60">
            <span v-for="lineNumber in lineNumbers" :key="lineNumber">{{ lineNumber }}</span>
          </span>
          <textarea v-model="draft" rows="7" spellcheck="false"
            class="min-h-40 min-w-0 flex-1 resize-none bg-transparent px-3 py-3 font-mono text-[12px] leading-5 text-ink outline-none placeholder:text-muted/50"
            @keydown="handleEditorKeydown" />
        </label>
      </div>
    </MarkdownModulePopover>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import { getNodeViewPopoverPosition } from '../shared/nodeViewPopover'
import { renderMermaid } from './mermaidRenderer'

const props = defineProps<NodeViewProps>()

const anchorElement = ref<HTMLElement | null>(null)
const popoverPosition = ref<Record<string, string>>({ left: '12px', top: '12px' })
const editing = ref(false)
const draft = ref(String(props.node.attrs.source))
const diagramHtml = ref('')
const renderError = ref('')
const rendering = ref(false)
let renderSequence = 0

// 行号随着源码内容同步变化，帮助刚接触 Mermaid 的用户快速定位语法问题。
const lineNumbers = computed(() => Array.from({ length: draft.value.split('\n').length }, (_, index) => index + 1))

const renderDiagram = async (source: string): Promise<void> => {
  const currentSequence = ++renderSequence
  rendering.value = true
  try {
    const renderId = `xmd-mermaid-${crypto.randomUUID()}`
    const svg = await renderMermaid(renderId, source)
    if (currentSequence !== renderSequence) return
    diagramHtml.value = svg
    renderError.value = ''
  } catch (error) {
    if (currentSequence !== renderSequence) return
    diagramHtml.value = ''
    renderError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (currentSequence === renderSequence) rendering.value = false
  }
}

const saveDraft = (): void => {
  const source = draft.value.trimEnd()
  props.updateAttributes({ source })
  void renderDiagram(source)
}

const startEditing = (): void => {
  if (!anchorElement.value) return
  popoverPosition.value = getNodeViewPopoverPosition(anchorElement.value, 500, 320)
  editing.value = true
}

const cancelEditing = (): void => {
  draft.value = String(props.node.attrs.source)
  editing.value = false
}

const saveEditing = (): void => {
  saveDraft()
  editing.value = false
}

// 编辑器内部按键不会传给文档；Ctrl+Enter 可直接保存当前图表源码。
const handleEditorKeydown = (event: KeyboardEvent): void => {
  event.stopPropagation()
  if (event.key !== 'Enter' || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
  event.preventDefault()
  saveEditing()
}

watch(
  () => props.node.attrs.source,
  (source) => {
    draft.value = String(source)
    void renderDiagram(String(source))
  },
)

onMounted(() => void renderDiagram(String(props.node.attrs.source)))
onBeforeUnmount(() => {
  renderSequence += 1
})
</script>
