<template>
  <!-- 原生选择框支持键盘操作，两个模式共用同一个底部入口。 -->
  <select :value="modelValue" title="选择 AI 模式" :disabled="disabled"
    class="h-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent px-1.5 text-xs text-secondary outline-none hover:bg-toolbar disabled:cursor-not-allowed disabled:opacity-50"
    @change="selectMode">
    <option value="chat">对话</option>
    <option value="agent">Agent</option>
  </select>
</template>

<script setup lang="ts">
defineProps<{ modelValue: 'chat' | 'agent'; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: 'chat' | 'agent'] }>()
// 只接受已定义的模式值，避免把任意输入当作模式。
const selectMode = (event: Event): void => {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'chat' || value === 'agent') emit('update:modelValue', value)
}
</script>
