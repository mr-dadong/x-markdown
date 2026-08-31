<template>
  <div ref="editorPanel"
    class="relative order-first mb-2 flex max-w-full flex-col overflow-hidden bg-toolbar"
    :style="panelStyle" contenteditable="false" @click.stop @mousedown.stop @wheel.stop
    @keydown.esc.prevent.stop="$emit('cancel')">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  width: number
  fullWidth?: boolean
}>()

const emit = defineEmits<{
  cancel: []
  submit: []
}>()

const editorPanel = ref<HTMLElement | null>(null)
const panelStyle = computed(() => ({ width: props.fullWidth ? '100%' : `${props.width}px` }))

const focusFirstField = (): void => {
  const field = editorPanel.value?.querySelector<HTMLElement>('textarea, input, [contenteditable="true"]')
  if (!field) return
  field.focus()
  // 与 Typora 一致，展开源码后把输入光标放到内容开头。
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    field.setSelectionRange(0, 0)
    return
  }
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(field)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const handleOutsidePointerDown = (event: PointerEvent): void => {
  if (editorPanel.value?.contains(event.target as Node)) return
  emit('submit')
}

onMounted(() => {
  void nextTick(focusFirstField)
  // 捕获外部点击，确保 TipTap 改变选区前先保存当前草稿。
  document.addEventListener('pointerdown', handleOutsidePointerDown, true)
})

onBeforeUnmount(() => document.removeEventListener('pointerdown', handleOutsidePointerDown, true))
</script>
