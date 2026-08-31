<template>
  <NodeViewWrapper class="relative my-5 flex w-full flex-col" data-xmd-mermaid-view>
    <div class="relative flex min-h-20 w-full cursor-text" contenteditable="false"
      title="点击编辑图表" @click.stop="startEditing">
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

    </div>

    <MarkdownModulePopover v-if="editing" :width="500" full-width @cancel="cancelEditing" @submit="saveEditing">
      <MarkdownSourceInput v-model="draft" language="mermaid" :min-height="120" @submit="saveEditing" />
    </MarkdownModulePopover>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import MarkdownSourceInput from '../shared/MarkdownSourceInput.vue'
import { renderMermaid } from './mermaidRenderer'

const props = defineProps<NodeViewProps>()

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
  if (editing.value) return
  draft.value = String(props.node.attrs.source)
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
