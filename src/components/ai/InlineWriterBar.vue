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
    <button v-if="isStreaming" type="button" class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-secondary hover:bg-control-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" :title="t('ai.stopGenerating')" @mousedown.prevent.stop="$emit('cancel')">
      <Icon icon="lucide:square" :size="11" />
      {{ t('ai.stop') }}
    </button>
    <div v-else-if="status === 'done'" class="flex shrink-0 items-center gap-1">
      <button type="button" class="flex h-8 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" @mousedown.prevent.stop="$emit('accept')">
        {{ t('ai.accept') }}
        <kbd class="font-mono text-[9px] text-white/70">Tab</kbd>
      </button>
      <button type="button" class="flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] text-secondary hover:bg-control-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" @mousedown.prevent.stop="$emit('reject')">
        {{ t('ai.discard') }}
        <kbd class="font-mono text-[9px] text-muted">Esc</kbd>
      </button>
    </div>
    <button v-else-if="status === 'error'" type="button" class="flex h-8 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" @mousedown.prevent.stop="$emit('retry')">
      <Icon icon="lucide:rotate-ccw" :size="12" />
      {{ t('ai.retry') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { t } from '../../composables/useI18n'
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
  if (props.status === 'error') return t('ai.writer.failed')
  if (props.status === 'done' && props.finishReason === 'length') return t('ai.writer.truncated')
  if (props.status === 'done' && props.finishReason === 'content-filter') return t('ai.writer.filtered')
  if (hasAbnormalFinish.value) return t('ai.writer.unexpectedEnd')
  if (props.status === 'done') return t('ai.writer.done')
  return props.hasOutput ? t('ai.writer.writing') : t('ai.writer.preparing')
})
const statusDetail = computed(() => {
  if (props.status === 'error') return props.error
  if (props.status === 'done' && props.finishReason === 'length') {
    const usage = props.completionTokens === null
      ? ''
      : t('ai.writer.tokensSuffix', { count: props.completionTokens })
    return t('ai.writer.limit', { usage })
  }
  if (props.status === 'done' && props.finishReason === 'content-filter') return t('ai.writer.filteredIncomplete')
  if (hasAbnormalFinish.value) return t('ai.writer.abnormal', { reason: props.finishReason ?? 'unknown' })
  if (props.status === 'done') {
    const usage = props.completionTokens === null
      ? t('ai.writer.noTokenStats')
      : t('ai.writer.tokenUsage', { count: props.completionTokens })
    return t('ai.writer.review', { usage })
  }
  if (props.hasOutput) return t('ai.writer.readOnlyStop')
  return t('ai.writer.readOnlyStart')
})
</script>
