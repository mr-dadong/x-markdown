<template>
  <div class="flex min-h-0 min-w-0 flex-1 bg-paper">
    <textarea
      ref="sourceEditor"
      :value="content"
      class="editor-scroll min-h-0 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-paper px-20 pb-[200px] pt-4 font-mono text-[14px] leading-6 text-ink outline-none placeholder:text-placeholder"
      placeholder="开始输入 Markdown 源码..."
      spellcheck="false"
      @input="handleInput"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  content: string
}>()

const emit = defineEmits<{
  'update:content': [content: string]
}>()

const sourceEditor = ref<HTMLTextAreaElement | null>(null)

// 两种显示模式的内容高度不同，因此使用 0 到 1 的阅读进度同步位置。
const getScrollProgress = (): number => {
  const element = sourceEditor.value
  if (!element) return 0
  const scrollableHeight = element.scrollHeight - element.clientHeight
  return scrollableHeight > 0 ? element.scrollTop / scrollableHeight : 0
}

const setScrollProgress = (progress: number): void => {
  const element = sourceEditor.value
  if (!element) return
  const scrollableHeight = element.scrollHeight - element.clientHeight
  element.scrollTop = Math.max(0, Math.min(1, progress)) * scrollableHeight
}

// 源码模式直接传递 textarea 的完整内容，继续复用现有文档修改和保存流程。
const handleInput = (event: Event): void => {
  emit('update:content', (event.target as HTMLTextAreaElement).value)
}

defineExpose({
  getScrollProgress,
  setScrollProgress,
})
</script>
