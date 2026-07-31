<template>
  <NodeViewWrapper
    class="my-2 flex w-[440px] max-w-full flex-col gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-3"
    contenteditable="false"
  >
    <div class="flex min-w-0 items-center gap-3">
      <span class="relative flex h-10 w-10 shrink-0 items-center justify-center">
        <!-- 双圆环仅通过透明度和尺寸呼吸，不使用阴影也能保持柔和的加载感。 -->
        <span v-if="isCopying" class="copy-pulse-ring absolute h-9 w-9 rounded-full border border-muted" />
        <span class="flex h-7 w-7 items-center justify-center rounded-full border border-ink bg-paper text-[9px] font-semibold text-ink">
          <Icon v-if="isFailed" icon="lucide:alert-triangle" :size="14" />
          <span v-else>{{ percent }}%</span>
        </span>
      </span>

      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-[13px] font-medium text-ink">{{ node.attrs.fileName }}</span>
        <span class="truncate text-[11px] text-muted">{{ statusText }}</span>
      </span>

      <span v-if="isCopying" class="shrink-0 font-mono text-[11px] font-semibold text-secondary">
        {{ percent }}%
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
const percent = computed(() => {
  const total = Number(props.node.attrs.totalBytes)
  const copied = Number(props.node.attrs.copiedBytes)
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((copied / total) * 100)))
})
const statusText = computed(() => {
  if (isFailed.value) return `复制失败 · ${props.node.attrs.error || '请重新插入文件'}`
  return `正在复制到 assets · ${formatAttachmentSize(Number(props.node.attrs.copiedBytes))} / ${formatAttachmentSize(Number(props.node.attrs.totalBytes))}`
})
</script>

<style scoped>
.copy-pulse-ring {
  animation: copy-pulse 1.6s ease-in-out infinite;
}

@keyframes copy-pulse {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.82);
  }

  50% {
    opacity: 0.9;
    transform: scale(1);
  }
}
</style>
