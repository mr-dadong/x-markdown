<template>
  <!--
    分页符在编辑区的可见形态：两侧虚线 + 文字标签。
    节点本身是原子节点，点击选中后按 Delete/Backspace 可以整块删除。
  -->
  <NodeViewWrapper class="my-4 flex items-center gap-3 select-none" data-xmd-page-break-view contenteditable="false">
    <span class="h-px min-w-4 flex-1 border-t border-dashed border-line" />
    <span class="text-[11px] font-medium tracking-[0.14em] text-muted">分页符</span>
    <span class="h-px min-w-4 flex-1 border-t border-dashed border-line" />
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'

// 声明 NodeViewProps 既是类型要求，也让该组件只能作为节点视图使用。
defineProps<NodeViewProps>()
</script>
