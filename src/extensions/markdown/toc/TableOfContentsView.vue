<template>
  <NodeViewWrapper class="my-[0.8em] flex w-full flex-col gap-1 rounded-md bg-toolbar/70 px-3 py-2"
    :class="props.selected ? 'bg-control' : ''" data-xmd-table-of-contents-view>
    <div class="flex h-7 items-center gap-2" contenteditable="false">
      <Icon icon="lucide:list-tree" :size="14" class="text-muted" />
      <span class="text-[12px] font-semibold text-ink">目录</span>
      <span v-if="headings.length" class="text-[10px] text-muted">{{ headings.length }} 项</span>
    </div>
    <div v-if="headings.length" class="flex flex-col gap-0.5" contenteditable="false">
      <button v-for="heading in headings" :key="heading.position" type="button"
        class="flex h-7 w-full items-center rounded-md pr-2 text-left text-[12px] text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        :style="{ paddingLeft: `${24 + (heading.level - minimumLevel) * 14}px` }"
        :title="`跳转到：${heading.text}`" @click="scrollToHeading(heading.position)">
        <span class="truncate">{{ heading.text }}</span>
      </button>
    </div>
    <div v-else class="flex h-7 items-center pl-6 text-[11px] text-muted" contenteditable="false">
      添加标题后自动生成
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface HeadingEntry {
  level: number
  position: number
  text: string
}

const props = defineProps<NodeViewProps>()
const headings = ref<HeadingEntry[]>([])
const minimumLevel = computed(() => headings.value.length
  ? Math.min(...headings.value.map((heading) => heading.level))
  : 1)

const refreshHeadings = (): void => {
  const nextHeadings: HeadingEntry[] = []
  props.editor.state.doc.descendants((node, position) => {
    if (node.type.name !== 'heading') return
    nextHeadings.push({
      level: Number(node.attrs.level),
      position,
      text: node.textContent || '未命名标题',
    })
  })
  headings.value = nextHeadings
}

const scrollToHeading = (position: number): void => {
  props.editor.chain().focus().setTextSelection(position + 1).scrollIntoView().run()
}

onMounted(() => {
  refreshHeadings()
  props.editor.on('update', refreshHeadings)
})

onBeforeUnmount(() => {
  props.editor.off('update', refreshHeadings)
})
</script>
