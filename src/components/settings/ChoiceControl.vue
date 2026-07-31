<template>
  <div class="flex rounded-md bg-toolbar p-0.5">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="flex h-9 items-center rounded px-3 text-[13px] font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      :class="modelValue === option.value ? 'border border-line bg-paper text-ink' : 'border border-transparent text-muted hover:text-ink'"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ modelValue: string; options: Array<{ value: string; label: string }> }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
