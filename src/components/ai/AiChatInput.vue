<template>
  <!-- 底部输入区 -->
  <div class="shrink-0 px-3 pb-3 pt-2">
    <!-- 输入卡片：圆角加发丝线边框，聚焦时描边变强调色 -->
    <div class="flex flex-col rounded-2xl border border-line bg-panel focus-within:border-accent">
      <!-- 待发送选区标签列表 -->
      <div v-if="pendingSelections && pendingSelections.length > 0" class="flex flex-wrap gap-1 px-3 pt-2.5">
        <div
          v-for="(selection, index) in pendingSelections"
          :key="index"
          class="flex max-w-fit items-center gap-1 rounded-md bg-selected py-0.5 pl-2 pr-1 text-[11px] text-secondary"
        >
          <Icon icon="lucide:quote" :size="10" />
          <span class="max-w-[120px] truncate">{{ truncateText(selection) }}</span>
          <button
            type="button"
            class="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-control-hover hover:text-ink"
            title="移除"
            @mousedown.prevent="$emit('remove-pending-selection', index)"
          >
            <Icon icon="lucide:x" :size="10" />
          </button>
        </div>
      </div>

      <!-- 输入区域 -->
      <textarea
        ref="inputRef"
        v-model="inputText"
        class="min-h-14 w-full resize-none border-0 bg-transparent px-3.5 pb-1 pt-2.5 text-[13px] leading-5 text-ink outline-none placeholder:text-muted disabled:opacity-60"
        :placeholder="placeholder"
        :disabled="isStreaming"
        rows="1"
        @keydown="handleKeydown"
        @input="autoResize"
      />

      <!-- 底部工具行：左侧放模型选择等扩展内容，右侧为发送/停止按钮 -->
      <div class="flex items-center justify-between gap-2 pb-2 pl-2.5 pr-2 pt-1">
        <div class="flex min-w-0 flex-1 items-center">
          <slot name="footer-left" />
        </div>
        <div class="flex shrink-0 items-center">
          <button
            v-if="isStreaming"
            type="button"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-danger text-inverse hover:opacity-80"
            title="停止生成"
            @mousedown.prevent="$emit('cancel')"
          >
            <Icon icon="lucide:square" :size="14" />
          </button>
          <button
            v-else
            type="button"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-accent text-inverse hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!canSend"
            title="发送 (Enter)"
            @mousedown.prevent="handleSend"
          >
            <Icon icon="lucide:arrow-up" :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Icon } from '@iconify/vue/offline'

const props = defineProps<{
  isStreaming: boolean
  pendingSelections?: string[]
}>()

const emit = defineEmits<{
  send: [content: string]
  cancel: []
  'clear-pending-selections': []
  'remove-pending-selection': [index: number]
}>()

const inputRef = ref<HTMLTextAreaElement | null>(null)
const inputText = ref('')

// 输入框最大高度，超出后内部滚动
const MAX_TEXTAREA_HEIGHT = 180

const canSend = computed(() => inputText.value.trim().length > 0 && !props.isStreaming)

const truncateText = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed
}

const placeholder = computed(() => {
  if (props.isStreaming) return '正在生成…'
  return '输入消息…'
})

const handleSend = (): void => {
  if (!canSend.value) return
  let content = inputText.value
  // 如果有 pending selections，附加到消息中
  if (props.pendingSelections && props.pendingSelections.length > 0) {
    const selectionsText = props.pendingSelections
      .map((s, i) => `选区${i + 1}：\n\`\`\`\n${s}\n\`\`\``)
      .join('\n\n')
    content = content + '\n\n' + selectionsText
    emit('clear-pending-selections')
  }
  emit('send', content)
  inputText.value = ''
  nextTick(() => autoResize())
}

const handleKeydown = (event: KeyboardEvent): void => {
  // Enter 发送，Shift+Enter 换行
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}

const autoResize = (): void => {
  const textarea = inputRef.value
  if (!textarea) return
  // 先重置为 auto 才能拿到内容真实高度；空内容时由 CSS min-height 撑起基础高度
  textarea.style.height = 'auto'
  const next = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)
  textarea.style.height = `${next}px`
  textarea.style.overflowY = textarea.scrollHeight > next ? 'auto' : 'hidden'
}

const focus = (): void => {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>
