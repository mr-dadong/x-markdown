<template>
  <!-- 直接展示两个模式，用实色标明当前选择，支持 Tab 聚焦和键盘点击。 -->
  <div class="flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-paper p-0.5" title="选择 AI 模式">
    <button v-for="item in modes" :key="item.value" type="button"
      class="flex h-6 cursor-pointer items-center justify-center rounded-md px-2 text-[11px] font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
      :class="modelValue === item.value ? 'bg-selected text-ink' : 'text-muted hover:bg-toolbar hover:text-ink'"
      :aria-pressed="modelValue === item.value" :disabled="disabled"
      @click="emit('update:modelValue', item.value)">
      {{ item.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ modelValue: 'chat' | 'agent'; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: 'chat' | 'agent'] }>()
// 固定可选模式，保留原有双向绑定接口。
const modes = [{ value: 'chat', label: '对话' }, { value: 'agent', label: 'Agent' }] as const
</script>
