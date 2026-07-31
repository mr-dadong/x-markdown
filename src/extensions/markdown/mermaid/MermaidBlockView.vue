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

    <MarkdownModulePopover v-if="editing" title="编辑图表" icon="lucide:braces" :position="popoverPosition"
      :width="480" @cancel="cancelEditing" @submit="saveEditing">
      <label class="flex min-h-48 items-start gap-2 px-2.5 py-2 focus-within:bg-paper">
        <span class="w-12 shrink-0 pt-1 text-[11px] text-muted">源码</span>
        <textarea v-model="draft" rows="9" spellcheck="false"
          class="min-h-44 min-w-0 flex-1 resize-none bg-transparent font-mono text-[12px] leading-5 text-ink outline-none placeholder:text-muted/50"
          @keydown.stop />
      </label>
    </MarkdownModulePopover>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
  popoverPosition.value = getNodeViewPopoverPosition(anchorElement.value, 480, 300)
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
