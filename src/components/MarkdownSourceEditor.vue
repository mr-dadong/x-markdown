<template>
  <div class="flex min-h-0 min-w-0 flex-1 bg-paper">
    <textarea
      ref="sourceEditor"
      :value="content"
      class="editor-scroll min-h-0 min-w-0 flex-1 resize-none overflow-y-auto border-0 bg-paper px-20 pb-[200px] pt-4 font-mono text-[14px] leading-6 text-ink outline-none placeholder:text-placeholder"
      placeholder="开始输入 Markdown 源码..."
      spellcheck="false"
      @input="handleInput"
      @keydown="handleKeydown"
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

// 源码模式按 Markdown 常用的两个空格缩进，并完整支持多行选区和 Shift+Tab 反向缩进。
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return

  event.preventDefault()
  const element = event.currentTarget as HTMLTextAreaElement
  const indentation = '  '
  const selectionStart = element.selectionStart
  const selectionEnd = element.selectionEnd

  if (selectionStart === selectionEnd && !event.shiftKey) {
    element.setRangeText(indentation, selectionStart, selectionEnd, 'end')
    emit('update:content', element.value)
    return
  }

  const firstLineStart = element.value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1
  const effectiveEnd = selectionEnd > selectionStart && element.value[selectionEnd - 1] === '\n'
    ? selectionEnd - 1
    : selectionEnd
  const nextLineBreak = element.value.indexOf('\n', effectiveEnd)
  const lastLineEnd = nextLineBreak === -1 ? element.value.length : nextLineBreak
  const selectedLines = element.value.slice(firstLineStart, lastLineEnd)

  if (!event.shiftKey) {
    const lineCount = selectedLines.split('\n').length
    const replacement = indentation + selectedLines.replaceAll('\n', `\n${indentation}`)
    element.setRangeText(replacement, firstLineStart, lastLineEnd, 'start')
    const nextStart = selectionStart + indentation.length
    const nextEnd = selectionStart === selectionEnd
      ? nextStart
      : selectionEnd + indentation.length * lineCount
    element.setSelectionRange(nextStart, nextEnd)
    emit('update:content', element.value)
    return
  }

  const lines = selectedLines.split('\n')
  const removedLengths = lines.map((line) => line.match(/^ {1,2}/)?.[0].length ?? 0)
  if (removedLengths.every((length) => length === 0)) return

  const replacement = lines.map((line, index) => line.slice(removedLengths[index])).join('\n')
  element.setRangeText(replacement, firstLineStart, lastLineEnd, 'start')
  const nextStart = Math.max(firstLineStart, selectionStart - removedLengths[0])
  const removedTotal = removedLengths.reduce((total, length) => total + length, 0)
  const nextEnd = selectionStart === selectionEnd
    ? nextStart
    : Math.max(nextStart, selectionEnd - removedTotal)
  element.setSelectionRange(nextStart, nextEnd)
  emit('update:content', element.value)
}

defineExpose({
  getScrollProgress,
  setScrollProgress,
})
</script>
