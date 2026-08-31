<template>
  <NodeViewWrapper as="sup" class="relative inline cursor-pointer align-super" data-xmd-footnote-reference-view
    contenteditable="false" @mouseenter="showPreview" @mouseleave="hidePreview">
    <span ref="anchorElement"
      class="mx-0.5 inline font-mono text-[10px] font-semibold text-link transition-colors hover:text-accent"
      :title="hasDefinition ? `脚注 ${identifier}` : `未找到脚注 ${identifier} 的定义`">
      [{{ identifier }}]
    </span>

    <div v-if="visible" :style="popoverStyle"
      class="fixed z-50 w-72 rounded-md border border-line bg-paper p-3 shadow-lg">
      <div class="mb-1 flex items-center gap-1.5 font-mono text-[11px] font-semibold text-link">
        <Icon icon="lucide:file-text" :size="12" />
        {{ identifier }}
      </div>
      <div v-if="previewBody" class="max-h-48 overflow-y-auto text-[12px] leading-5 text-secondary [&_ol]:m-0 [&_ol]:pl-5 [&_p]:m-0 [&_p]:text-[12px] [&_ul]:m-0 [&_ul]:pl-5"
        v-html="renderedBody" />
      <div v-else class="text-[12px] leading-5 text-muted">未找到对应的脚注定义。</div>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, ref } from 'vue'
import { getNodeViewPopoverPosition } from '../shared/nodeViewPopover'
import { renderSafeMarkdown } from '../shared/safeMarkdown'

const props = defineProps<NodeViewProps>()

const anchorElement = ref<HTMLElement | null>(null)
const visible = ref(false)
const previewBody = ref<string | null>(null)
const hasDefinition = ref(false)
const popoverStyle = ref<Record<string, string>>({})

const identifier = computed(() => String(props.node.attrs.identifier))
// 悬停时才查找定义：文档随时可能变化（引用/定义增删、标识改名），
// 在事件时刻读取最新文档比用 computed 缓存更可靠。
const findDefinitionBody = (): string | null => {
  const found: { body: string | null } = { body: null }
  props.editor.state.doc.descendants((node) => {
    if (found.body !== null) return false
    if (node.type.name === 'footnoteDefinition'
      && String(node.attrs.identifier) === identifier.value) {
      found.body = String(node.attrs.body)
      return false
    }
    return true
  })
  return found.body
}

const renderedBody = computed(() => renderSafeMarkdown(previewBody.value ?? ''))

const showPreview = (): void => {
  if (!anchorElement.value) return
  previewBody.value = findDefinitionBody()
  hasDefinition.value = previewBody.value !== null
  const size = previewBody.value ? { width: 288, height: 96 } : { width: 200, height: 40 }
  popoverStyle.value = getNodeViewPopoverPosition(anchorElement.value, size.width, size.height)
  visible.value = true
}

const hidePreview = (): void => {
  visible.value = false
}
</script>
