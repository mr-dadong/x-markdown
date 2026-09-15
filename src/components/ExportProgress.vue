<template>
  <!-- 导出期间锁定编辑区，避免用户重复触发导出或切换文档。 -->
  <div v-if="visible" class="fixed inset-0 z-[130] flex items-center justify-center bg-black/35 p-6" role="dialog">
    <!-- 与确认弹窗同规格：圆角、边框、头部图标底衬，保持全应用弹窗视觉一致。 -->
    <section class="flex w-[min(400px,92vw)] flex-col overflow-hidden rounded-lg border border-line bg-paper">
      <header class="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <!-- 图标套浅灰底衬，避免裸图标悬浮发飘。 -->
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel text-muted">
          <Icon icon="lucide:share" :size="15" />
        </div>
        <h2 class="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-ink">正在导出 {{ formatLabel }}
        </h2>
        <!-- 百分比靠右对齐标题行，不再悬在卡片中间。 -->
        <span class="shrink-0 font-mono text-[12px] text-muted">{{ progress }}%</span>
      </header>

      <div class="flex flex-col gap-3 px-5 py-4">
        <p class="truncate text-[12px] leading-5 text-secondary">{{ message }}</p>
        <!-- 进度条用主题强调色（浅主题近黑、深主题浅灰），贴合黑白灰设计语言。 -->
        <div class="flex h-1 w-full overflow-hidden rounded-full bg-control">
          <div class="flex h-full bg-accent" :style="{ width: `${progress}%` }" />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'

defineProps<{
  visible: boolean
  formatLabel: string
  message: string
  progress: number
}>()
</script>
