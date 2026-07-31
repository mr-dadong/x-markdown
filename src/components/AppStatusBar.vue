<template>
  <footer
    class="flex h-[30px] shrink-0 items-center justify-between border-t border-line bg-toolbar px-1 select-none"
  >
    <div class="flex items-center">
      <!-- 侧边栏入口放在窗口左下角，激活底色用于提示当前展开状态。 -->
      <button
        type="button"
        class="flex h-7 w-8 items-center justify-center rounded hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
        :class="sidebarVisible ? 'bg-control-active text-ink' : 'bg-transparent text-icon'"
        :title="sidebarVisible ? '收缩侧边栏 (Ctrl+B)' : '展开侧边栏 (Ctrl+B)'"
        @click="emit('toggle-sidebar')"
      >
        <Icon icon="lucide:panel-left" :size="17" />
      </button>
      <!-- 与侧边栏按钮相邻，便于随时切换 Markdown 的源码和渲染编辑方式。 -->
      <button
        type="button"
        class="flex h-7 w-8 items-center justify-center rounded hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
        :class="sourceMode ? 'bg-control-active text-ink' : 'bg-transparent text-icon'"
        :disabled="!documentOpen"
        :title="sourceMode ? '切换到 Markdown 渲染视图' : '切换到 Markdown 源码视图'"
        @click="emit('toggle-source-mode')"
      >
        <Icon :icon="sourceMode ? 'lucide:pen-line' : 'lucide:braces'" :size="17" />
      </button>
    </div>
    <div v-if="documentOpen" class="flex h-full items-center pr-2 text-[12px] text-secondary">
      <!-- 保存状态和文档统计以分隔线区分，便于快速扫读。 -->
      <span class="flex items-center gap-1.5 pr-3">
        <Icon :icon="isModified ? 'lucide:circle' : 'lucide:check'" :size="14" />
        {{ isModified ? '未保存' : '已保存' }}
      </span>
      <span class="flex h-4 items-center border-l border-line pl-3">{{ lineCount }} 行</span>
      <span class="ml-4">{{ wordCount }} 词</span>
      <span class="ml-4">{{ characterCount }} 字符</span>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'

defineProps<{
  lineCount: number
  wordCount: number
  characterCount: number
  isModified: boolean
  sidebarVisible: boolean
  sourceMode: boolean
  documentOpen: boolean
}>()

const emit = defineEmits<{
  'toggle-sidebar': []
  'toggle-source-mode': []
}>()
</script>
