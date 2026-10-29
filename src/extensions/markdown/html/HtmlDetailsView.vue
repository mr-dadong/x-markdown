<template>
  <!-- 摘要行只读：修改摘要走源码模式；折叠只是视图状态，不写进文档与 Markdown。 -->
  <NodeViewWrapper
    class="my-3 flex w-full flex-col rounded-lg border border-line"
    data-xmd-html-details
    :data-collapsed="collapsed ? 'true' : null"
  >
    <button
      type="button"
      class="flex w-full items-center gap-2 border-b border-line bg-toolbar px-3 py-2 text-left text-[13px] font-semibold text-ink"
      contenteditable="false"
      data-xmd-html-details-toggle
      @click="toggleCollapsed"
    >
      <span data-xmd-html-details-indicator>{{ collapsed ? '▸' : '▾' }}</span>
      <span>{{ title }}</span>
    </button>
    <div v-show="!collapsed" class="flex w-full flex-col px-3 py-2" data-xmd-html-details-body>
      <NodeViewContent as="div" class="flex w-full flex-col" />
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'
import { computed, ref } from 'vue'
import { summaryPlainText } from './htmlContainerSource'
import { moveSelectionOutOfDetails } from './htmlDetailsToggle'

const props = defineProps<NodeViewProps>()

const title = computed(() => summaryPlainText(String(props.node.attrs.summarySource ?? '')))
const collapsed = ref(false)

/** 收起只是视图状态；光标若在内容区里，顺手移到面板之后。 */
const toggleCollapsed = (): void => {
  collapsed.value = !collapsed.value
  if (!collapsed.value) return
  moveSelectionOutOfDetails(props.editor, props.getPos(), props.node.nodeSize)
}
</script>
