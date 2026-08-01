<template>
  <NodeViewWrapper
    class="my-2 flex h-20 w-[440px] max-w-full flex-col justify-center gap-2 rounded-lg border border-line bg-paper px-3"
    contenteditable="false"
  >
    <div class="flex min-w-0 items-center gap-3">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ink px-1 font-mono text-[9px] font-bold tracking-tight text-inverse">
        <Icon v-if="isFailed" icon="lucide:alert-triangle" :size="14" />
        <span v-else>{{ fileType }}</span>
      </span>

      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-[13px] font-medium text-ink">{{ node.attrs.fileName }}</span>
        <span v-if="isFailed" class="truncate text-[11px] text-danger">
          复制失败 · {{ node.attrs.error || '请重新插入文件' }}
        </span>
        <span v-else class="flex items-center gap-1 text-[11px] text-muted">
          <span class="shrink-0">复制到 assets</span>
          <span class="shrink-0">·</span>
          <span class="truncate">{{ copiedSize }} / {{ totalSize }}</span>
        </span>
      </span>

      <span v-if="isCopying" class="flex w-16 shrink-0 flex-col items-end gap-0.5 font-mono">
        <span class="text-[11px] font-semibold text-secondary">{{ percent }}%</span>
        <span class="text-[10px] text-muted">{{ speedText }}</span>
      </span>
    </div>

    <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-control">
      <span
        class="flex h-full rounded-full bg-ink"
        :style="{ width: `${percent}%` }"
      />
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3'
import { formatAttachmentSize } from '../extensions/Attachment'

const props = defineProps<NodeViewProps>()

const isCopying = computed(() => props.node.attrs.status === 'copying')
const isFailed = computed(() => props.node.attrs.status === 'failed')
const fileType = computed(() => {
  const extension = String(props.node.attrs.fileName).split('.').pop()
  return extension && extension !== props.node.attrs.fileName ? extension.slice(0, 4).toUpperCase() : 'FILE'
})
const percent = computed(() => {
  const total = Number(props.node.attrs.totalBytes)
  const copied = Number(props.node.attrs.copiedBytes)
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((copied / total) * 100)))
})
const speedText = computed(() => `${formatAttachmentSize(Number(props.node.attrs.bytesPerSecond))}/s`)
const copiedSize = computed(() => formatAttachmentSize(Number(props.node.attrs.copiedBytes)))
const totalSize = computed(() => formatAttachmentSize(Number(props.node.attrs.totalBytes)))
</script>
