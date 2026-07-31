<template>
  <div class="flex items-start justify-between gap-8 border-b border-line py-5">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <h4 class="text-[14px] font-semibold text-ink">{{ title }}</h4>
      <p class="max-w-md text-[12px] leading-5 text-muted">{{ description }}</p>
    </div>
    <div class="flex shrink-0 items-center"><slot /></div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; description: string }>()
</script>
