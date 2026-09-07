<template>
  <!-- 执行过程在任务正文中展开；阶段完成只来自实际事件。 -->
  <section class="flex shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-paper">
    <div class="flex items-start justify-between gap-3 border-b border-line px-3 py-3">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="text-xs font-semibold text-ink">{{ title }}</span>
        <span class="text-[11px] leading-5 text-muted">{{ running ? '正在处理当前文档' : '本次执行记录' }} · {{ elapsed }} 秒<span v-if="running && taskMs"> / 总预算 {{ Math.round(taskMs / 60000) }} 分钟</span></span>
      </div>
      <span v-if="step" class="shrink-0 rounded-md bg-toolbar px-2 py-1 text-[10px] text-muted">{{ step }} / {{ maxSteps }} 轮</span>
    </div>
    <p v-if="budgetMessage" class="border-b border-line px-3 py-2 text-[11px] leading-5 text-secondary">{{ budgetMessage }}</p>
    <div class="flex flex-col gap-1 p-2">
      <div v-for="(stage, index) in stages" :key="stage.id" class="flex items-start gap-2.5 rounded-lg px-2 py-2"
        :class="stage.state === 'running' ? 'bg-selected' : ''">
        <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]"
          :class="stage.state === 'interrupted' ? 'border-danger text-danger' : stage.state === 'running' ? 'border-accent bg-accent text-inverse' : 'border-line text-muted'">
          {{ stage.state === 'done' ? '✓' : stage.state === 'interrupted' ? '!' : index + 1 }}
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium" :class="stage.state === 'pending' || stage.state === 'skipped' ? 'text-muted' : 'text-ink'">{{ stage.title }}</span>
            <span class="shrink-0 text-[10px] text-muted">{{ stageLabels[stage.state] }}</span>
          </div>
          <p v-if="stage.detail" class="break-words text-[11px] leading-5 text-secondary">{{ stage.detail }}</p>
        </div>
      </div>
    </div>
    <div v-if="goals.length" class="flex flex-col gap-2 border-t border-line px-3 py-3">
      <span class="text-[11px] font-medium text-ink">目标核对 <span class="font-normal text-muted">· AI 报告</span></span>
      <div v-for="goal in goals" :key="goal.id" class="flex flex-col gap-1">
        <div class="flex items-start gap-2 text-[11px] leading-5">
          <span class="shrink-0 text-muted">{{ goal.state === 'done' ? '✓' : goal.state === 'unresolved' ? '未解决' : '待核对' }}</span>
          <span class="text-ink">{{ goal.title }}</span>
        </div>
        <p v-if="goal.detail" class="break-words text-[11px] leading-5 text-secondary">{{ goal.detail }}</p>
      </div>
    </div>
    <div v-if="operations.length" class="flex flex-col gap-2 border-t border-line px-3 py-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-medium text-ink">操作结果 · {{ operations.length }}</span>
        <button v-if="operations.length > 3" type="button" class="text-[11px] text-muted hover:text-ink" :aria-expanded="showAll" @click="showAll = !showAll">{{ showAll ? '收起记录' : '查看全部' }}</button>
      </div>
      <div class="flex max-h-64 flex-col gap-2 overflow-y-auto">
        <div v-for="operation in visibleOperations" :key="operation.id" class="flex flex-col gap-1 rounded-lg bg-toolbar px-2.5 py-2">
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <span :class="operation.state === 'error' ? 'text-danger' : 'text-ink'">{{ operation.title }}</span>
            <span class="shrink-0 text-muted">{{ operation.state === 'running' ? '执行中' : operation.state === 'error' ? '未完成' : '已完成' }} · {{ operationSeconds(operation) }} 秒</span>
          </div>
          <p v-if="operation.detail" class="break-words text-[11px] leading-5 text-secondary">{{ operation.detail }}</p>
        </div>
      </div>
    </div>
    <div v-if="reasoning" class="flex flex-col border-t border-line">
      <button type="button" class="flex px-3 py-2 text-[11px] text-muted hover:text-ink" :aria-expanded="showReasoning" @click="showReasoning = !showReasoning">{{ showReasoning ? '收起模型思考' : '查看模型思考' }}</button>
      <p v-if="showReasoning" class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-3 text-[11px] leading-5 text-secondary">{{ reasoning }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { DocumentAgentGoal, DocumentAgentOperation, DocumentAgentStage } from '../../types/documentAgent'

const props = defineProps<{
  running: boolean
  status: string
  outcome: 'complete' | 'incomplete' | null
  stages: Array<{ id: DocumentAgentStage; title: string; state: 'pending' | 'running' | 'done' | 'interrupted' | 'skipped'; detail: string }>
  operations: DocumentAgentOperation[]
  goals: DocumentAgentGoal[]
  reasoning: string
  startedAt: number
  endedAt: number
  step: number
  maxSteps: number
  taskMs: number
  budgetMessage: string
}>()
const showAll = ref(false)
const showReasoning = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
// 只在任务运行时刷新耗时；结束后固定显示结束时间，卸载时清理计时器。
watch(() => [props.running, props.startedAt], () => {
  clearInterval(timer)
  now.value = Date.now()
  if (props.running) timer = setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })
watch(() => props.startedAt, () => { showAll.value = false; showReasoning.value = false })
onBeforeUnmount(() => clearInterval(timer))
const elapsed = computed(() => Math.max(0, Math.floor(((props.endedAt || now.value) - props.startedAt) / 1000)))
const operationSeconds = (operation: DocumentAgentOperation): string =>
  (Math.max(0, (operation.endedAt ?? (props.endedAt || now.value)) - operation.startedAt) / 1000).toFixed(1)
const visibleOperations = computed(() => showAll.value ? props.operations : props.operations.slice(-3))
const stageLabels = { pending: '待执行', running: '进行中', done: '已完成', interrupted: '已中断', skipped: '未执行' }
const title = computed(() => {
  if (props.running) return '任务进行中'
  if (props.status === 'error' || props.status === 'conflict') return '任务中断，尚未完成'
  if (props.status === 'cancelled') return '任务已停止'
  if (props.outcome === 'incomplete') return '执行已结束，仍有未完成事项'
  return props.status === 'review' ? '建议已准备好，等待审阅' : '本轮已结束'
})
</script>
