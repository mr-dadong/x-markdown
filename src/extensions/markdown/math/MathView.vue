<template>
  <NodeViewWrapper v-if="displayMode" class="relative my-5 flex w-full flex-col" data-xmd-math-view>
    <div class="relative flex min-h-12 w-full cursor-text items-center justify-center overflow-x-auto px-4 py-2"
      contenteditable="false" title="点击编辑公式" @click.stop="startEditing">
      <span v-if="renderError" class="font-mono text-[12px] text-danger">{{ renderError }}</span>
      <span v-else v-html="renderedMath" />
    </div>

    <MarkdownModulePopover v-if="editing" :width="380" full-width @cancel="cancelEditing" @submit="saveEditing">
      <MarkdownSourceInput v-model="draft" language="math" @submit="saveEditing" />
    </MarkdownModulePopover>
  </NodeViewWrapper>

  <NodeViewWrapper v-else class="relative"
    :class="[
      editing ? 'my-2 flex w-full flex-col' : 'mx-0.5 inline-flex items-center rounded px-0.5',
      props.selected && !editing ? 'bg-selected' : '',
    ]"
    data-xmd-math-view contenteditable="false"
    title="点击编辑公式" @click.stop="startEditing">
    <span class="inline-flex cursor-text items-center">
      <span v-if="renderError" class="font-mono text-[12px] text-danger">{{ renderError }}</span>
      <span v-else v-html="renderedMath" />
    </span>
    <MarkdownModulePopover v-if="editing" :width="360" full-width @cancel="cancelEditing" @submit="saveEditing">
      <MarkdownSourceInput v-model="draft" language="math" @submit="saveEditing" />
    </MarkdownModulePopover>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { computed, ref, watch } from 'vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import MarkdownSourceInput from '../shared/MarkdownSourceInput.vue'
import { renderMath } from './mathRenderer'

const props = defineProps<NodeViewProps>()

const displayMode = computed(() => props.node.type.name === 'mathBlock')
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
  if (editing.value) return
  draft.value = String(props.node.attrs.expression)
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
