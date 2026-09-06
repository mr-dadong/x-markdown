<template>
  <!-- 固定在输入框上方；展开内容有高度上限，不会把输入框挤出侧栏。 -->
  <div class="mx-3 mt-2 flex shrink-0 flex-col rounded-lg border border-line bg-paper">
    <button type="button" class="flex min-w-0 items-center gap-2.5 px-3 py-2 text-left" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-selected" :class="failed ? 'text-danger' : 'text-accent'">
        <Icon :icon="failed ? 'lucide:alert-circle' : running ? 'lucide:sparkles' : 'lucide:check'" :size="15" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-xs font-medium text-ink">{{ title }}</span>
        <span class="truncate text-[11px] text-muted">{{ detail }}</span>
      </span>
      <Icon :icon="expanded ? 'lucide:chevron-down' : 'lucide:chevron-up'" :size="13" class="shrink-0 text-muted" />
    </button>
    <div v-if="expanded" class="flex max-h-48 select-text flex-col gap-2 overflow-y-auto border-t border-line px-3 py-2 text-[11px] leading-5 text-muted">
      <template v-if="reasoning">
        <span class="font-medium text-secondary">思考过程</span>
        <p class="whitespace-pre-wrap break-words">{{ reasoning }}</p>
      </template>
      <span v-if="logs.length" class="font-medium text-secondary">执行记录</span>
      <p v-for="(log, index) in logs" :key="index">{{ index + 1 }}. {{ log }}</p>
      <p v-if="!reasoning && !logs.length">等待模型响应…</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue/offline'

const props = defineProps<{
  running: boolean
  status: string
  phase: 'thinking' | 'executing' | 'writing'
  reasoning: string
  logs: string[]
}>()
const expanded = ref(false)
const failed = computed(() => props.status === 'error' || props.status === 'conflict')
const title = computed(() => {
  if (props.running) return { thinking: 'AI 正在思考', executing: 'AI 正在执行', writing: 'AI 正在整理结果' }[props.phase]
  if (failed.value) return props.status === 'conflict' ? '文档已变化' : '任务执行失败'
  if (props.status === 'cancelled') return '任务已停止'
  return props.status === 'review' ? '修改已准备好，等待审阅' : '任务已完成'
})
// 折叠时显示最新思考片段；没有模型思考内容时如实显示工具进度。
const detail = computed(() => {
  if (props.running && props.phase === 'thinking' && props.reasoning) return props.reasoning.trim().split('\n').filter(Boolean).slice(-1)[0]
  if (props.logs.length) return props.logs[props.logs.length - 1]
  return '等待模型响应…'
})
</script>
