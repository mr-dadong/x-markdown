<template>
  <NodeViewWrapper v-if="displayMode" class="my-5 flex w-full" data-xmd-math-view>
    <div ref="anchorElement"
      class="relative flex min-h-12 w-full items-center justify-center overflow-x-auto px-4 py-2"
      contenteditable="false" title="双击编辑公式" @dblclick.stop="startEditing">
      <span v-if="renderError" class="font-mono text-[12px] text-danger">{{ renderError }}</span>
      <span v-else v-html="renderedMath" />
      <button v-if="props.selected && !editing" type="button" title="编辑公式"
        class="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @click.stop="startEditing">
        <Icon icon="lucide:pen-line" :size="14" />
      </button>
    </div>

    <MarkdownModulePopover v-if="editing" title="编辑公式" icon="lucide:braces" :position="popoverPosition"
      :width="380" @cancel="cancelEditing" @submit="saveEditing">
      <label class="flex min-h-24 items-start gap-2 px-2.5 py-2 focus-within:bg-paper">
        <span class="w-12 shrink-0 pt-1 text-[11px] text-muted">TeX</span>
        <textarea v-model="draft" rows="4" spellcheck="false"
          class="min-h-20 min-w-0 flex-1 resize-none bg-transparent font-mono text-[12px] leading-5 text-ink outline-none placeholder:text-muted/50"
          @keydown.esc.prevent="cancelEditing" @keydown.stop />
      </label>
    </MarkdownModulePopover>
  </NodeViewWrapper>

  <NodeViewWrapper v-else class="relative mx-0.5 inline-flex items-center rounded px-0.5"
    :class="props.selected ? 'bg-selected' : ''" data-xmd-math-view contenteditable="false"
    title="双击编辑公式" @dblclick.stop="startEditing">
    <span ref="anchorElement" class="inline-flex items-center">
      <span v-if="renderError" class="font-mono text-[12px] text-danger">{{ renderError }}</span>
      <span v-else v-html="renderedMath" />
    </span>
    <MarkdownModulePopover v-if="editing" title="编辑公式" icon="lucide:braces" :position="popoverPosition"
      :width="360" @cancel="cancelEditing" @submit="saveEditing">
      <label class="flex h-10 items-center gap-2 px-2.5 focus-within:bg-paper">
        <span class="w-12 shrink-0 text-[11px] text-muted">TeX</span>
        <input v-model="draft" type="text" spellcheck="false"
          class="h-full min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-muted/50"
          @keydown.enter.prevent="saveEditing" @keydown.esc.prevent="cancelEditing" @keydown.stop>
      </label>
    </MarkdownModulePopover>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, ref, watch } from 'vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import { getNodeViewPopoverPosition } from '../shared/nodeViewPopover'
import { renderMath } from './mathRenderer'

const props = defineProps<NodeViewProps>()

const displayMode = computed(() => props.node.type.name === 'mathBlock')
const anchorElement = ref<HTMLElement | null>(null)
const popoverPosition = ref<Record<string, string>>({ left: '12px', top: '12px' })
const editing = ref(false)
const draft = ref(String(props.node.attrs.expression))
const renderedMath = ref('')
const renderError = ref('')
let renderRevision = 0

const renderExpression = async (expression: string): Promise<void> => {
  const currentRevision = ++renderRevision
  try {
    const rendered = await renderMath(expression, {
      displayMode: displayMode.value,
      throwOnError: true,
      trust: false,
      strict: 'warn',
      output: 'htmlAndMathml',
    })
    // 快速连续编辑时只接受最后一次渲染，避免较早的异步结果覆盖新公式。
    if (currentRevision !== renderRevision) return
    renderedMath.value = rendered
    renderError.value = ''
  } catch (error) {
    if (currentRevision !== renderRevision) return
    renderedMath.value = ''
    renderError.value = error instanceof Error ? error.message : String(error)
  }
}

const saveExpression = (): void => {
  const expression = draft.value.trim()
  if (expression === String(props.node.attrs.expression)) {
    void renderExpression(expression)
    return
  }
  props.updateAttributes({ expression })
}

const startEditing = (): void => {
  if (!anchorElement.value) return
  const width = displayMode.value ? 380 : 360
  const height = displayMode.value ? 170 : 120
  popoverPosition.value = getNodeViewPopoverPosition(anchorElement.value, width, height)
  editing.value = true
}

const cancelEditing = (): void => {
  draft.value = String(props.node.attrs.expression)
  editing.value = false
}

const saveEditing = (): void => {
  saveExpression()
  editing.value = false
}

watch(
  () => props.node.attrs.expression,
  (expression) => {
    draft.value = String(expression)
    void renderExpression(String(expression))
  },
  { immediate: true },
)
</script>
