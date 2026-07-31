<template>
  <button
    type="button"
    :title="modelValue ? '点击关闭' : '点击开启'"
    class="flex h-6 w-11 items-center rounded-full p-0.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent"
    :class="modelValue ? 'justify-end bg-ink' : 'justify-start bg-control'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="flex h-5 w-5 rounded-full bg-paper" />
  </button>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
