<template>
  <div class="flex flex-col pb-5" :class="showDivider ? 'border-b border-line' : ''">
    <h3 class="text-[21px] font-semibold tracking-tight text-ink">{{ title }}</h3>
    <p class="mt-1 text-[13px] leading-6 text-muted">{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
// 紧邻带边框内容时可关闭分隔线，避免两条边线在视觉上重复。
withDefaults(defineProps<{ title: string; description: string; showDivider?: boolean }>(), {
  showDivider: true,
})
</script>
