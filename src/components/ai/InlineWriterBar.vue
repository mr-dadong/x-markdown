<template>
  <!-- 限制状态框宽度，避免在宽屏中贴着编辑器两侧边界。 -->
  <div class="pointer-events-auto flex min-h-12 w-full max-w-[720px] items-center gap-2.5 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-ink" contenteditable="false">
    <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-selected" :class="status === 'error' || hasAbnormalFinish ? 'text-danger' : 'text-accent'">
      <Icon :icon="statusIcon" :size="16" />
    </span>
    <div class="flex min-w-0 flex-1 flex-col">
      <span class="truncate text-[14px] font-semibold leading-5">{{ statusTitle }}</span>
      <span class="truncate text-[12px] leading-5 text-muted" :title="statusDetail">{{ statusDetail }}</span>
    </div>
    <button v-if="isStreaming" type="button" class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-secondary hover:bg-control-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" title="停止生成" @mousedown.prevent.stop="$emit('cancel')">
      <Icon icon="lucide:square" :size="11" />
      停止
    </button>
    <div v-else-if="status === 'done'" class="flex shrink-0 items-center gap-1">
      <button type="button" class="flex h-8 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" @mousedown.prevent.stop="$emit('accept')">
        接受
        <kbd class="font-mono text-[9px] text-white/70">Tab</kbd>
      </button>
      <button type="button" class="flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] text-secondary hover:bg-control-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" @mousedown.prevent.stop="$emit('reject')">
        放弃
        <kbd class="font-mono text-[9px] text-muted">Esc</kbd>
      </button>
    </div>
    <button v-else-if="status === 'error'" type="button" class="flex h-8 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" @mousedown.prevent.stop="$emit('retry')">
      <Icon icon="lucide:rotate-ccw" :size="12" />
      重试
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { AiEditAction, AiFinishReason } from '../../types/ai'

const props = defineProps<{
  status: 'idle' | 'streaming' | 'done' | 'error'
  error: string
  currentAction: AiEditAction | null
  hasOutput: boolean
  finishReason: AiFinishReason | null
  completionTokens: number | null
}>()

defineEmits<{
  accept: []
  reject: []
  cancel: []
  retry: []
}>()

const isStreaming = computed(() => props.status === 'streaming')
const hasAbnormalFinish = computed(() => props.status === 'done' && props.finishReason !== 'stop')
const statusIcon = computed(() => {
  if (props.status === 'error') return 'lucide:alert-circle'
  if (hasAbnormalFinish.value) return 'lucide:alert-circle'
  if (props.status === 'done') return 'lucide:check'
  return props.hasOutput ? 'lucide:pen-line' : 'lucide:sparkles'
})
const statusTitle = computed(() => {
  if (props.status === 'error') return 'AI 编写失败'
  if (props.status === 'done' && props.finishReason === 'length') return 'AI 输出已截断'
  if (props.status === 'done' && props.finishReason === 'content-filter') return 'AI 输出被内容过滤终止'
  if (hasAbnormalFinish.value) return 'AI 输出意外结束'
  if (props.status === 'done') return 'AI 编写完成'
  return props.hasOutput ? 'AI 正在写入' : 'AI 正在准备内容'
})
const statusDetail = computed(() => {
  if (props.status === 'error') return props.error
  if (props.status === 'done' && props.finishReason === 'length') {
    const usage = props.completionTokens === null ? '' : `，已输出 ${props.completionTokens} tokens`
    return `已达到模型最大输出限制${usage}；当前内容可能不完整，可接受或放弃`
  }
  if (props.status === 'done' && props.finishReason === 'content-filter') return '模型因内容过滤停止生成；当前内容可能不完整'
  if (hasAbnormalFinish.value) return `模型结束原因：${props.finishReason ?? 'unknown'}；当前内容可能不完整`
  if (props.status === 'done') {
    const usage = props.completionTokens === null
      ? '模型未返回 token 统计'
      : `本次输出 ${props.completionTokens} tokens`
    return `${usage}；检查结果后接受，或放弃并恢复原文`
  }
  if (props.hasOutput) return '正文暂时只读，停止会保留已经生成的内容'
  return '原文保持不变，正文暂时只读；模型开始输出后再写入'
})
</script>
