<template>
  <!-- 摘要行只读：修改摘要走源码模式，内容区始终展开以便直接编辑。 -->
  <NodeViewWrapper class="my-3 flex w-full flex-col rounded-lg border border-line" data-xmd-html-details>
    <div
      class="flex items-center border-b border-line bg-toolbar px-3 py-2 text-[13px] font-semibold text-ink"
      contenteditable="false"
      data-xmd-html-details-summary
    >
      {{ title }}
    </div>
    <NodeViewContent as="div" class="flex w-full flex-col px-3 py-2" />
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'
import { computed } from 'vue'
import { summaryPlainText } from './htmlContainerSource'

const props = defineProps<NodeViewProps>()

const title = computed(() => summaryPlainText(String(props.node.attrs.summarySource ?? '')))
</script>
