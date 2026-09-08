<template>
  <!-- 当前状态始终位于顶部，计划、工具和思考只作为可展开的过程信息。 -->
  <section class="flex min-w-0 flex-col rounded-xl border border-line bg-panel px-3 py-2.5">
    <button type="button"
      class="flex min-w-0 cursor-pointer items-center gap-3 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
        :class="statusTone">
        <Icon v-if="running" icon="lucide:loader-2" :size="15" class="agent-spin" />
        <Icon v-else-if="status === 'error' || status === 'conflict'" icon="lucide:alert-circle" :size="15" />
        <Icon v-else-if="status === 'cancelled'" icon="lucide:square" :size="13" />
        <Icon v-else icon="lucide:check" :size="15" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-[13px] font-medium text-ink">{{ primaryTitle }}</span>
        <span class="truncate text-[10px] text-muted">{{ primaryDetail }}</span>
      </span>
      <span class="shrink-0 text-[10px] text-muted">{{ elapsed }} 秒</span>
      <Icon icon="lucide:chevron-down" :size="14" class="agent-chevron shrink-0 text-muted"
        :class="detailsOpen ? '' : '-rotate-90'" />
    </button>

    <Transition name="agent-reveal">
      <div v-if="detailsOpen" class="mt-2 flex flex-col gap-2 border-t border-line pt-2">
        <p v-if="budgetMessage" class="rounded-md bg-toolbar px-2 py-1.5 text-[10px] leading-4 text-secondary">{{ budgetMessage }}</p>

        <!-- 计划位于操作记录之前，符合任务实际发生顺序。 -->
        <div v-if="goals.length" class="flex flex-col">
          <button type="button" class="flex min-h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 text-left text-[11px] text-secondary hover:bg-toolbar"
            :aria-expanded="goalsOpen" @click.stop="goalsOpen = !goalsOpen">
            <Icon icon="lucide:list-checks" :size="13" class="shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate">计划 · {{ goalSummary }}</span>
            <Icon icon="lucide:chevron-down" :size="12" class="agent-chevron shrink-0 text-muted"
              :class="goalsOpen ? '' : '-rotate-90'" />
          </button>
          <Transition name="agent-reveal">
            <div v-if="goalsOpen" class="flex flex-col gap-1 py-1 pl-6 pr-1">
              <div v-for="goal in goals" :key="goal.id" class="flex min-w-0 items-start gap-2 text-[11px] leading-5">
                <span class="flex h-5 w-3 shrink-0 items-center justify-center"
                  :class="goal.state === 'unresolved' ? 'text-danger' : 'text-muted'">
                  {{ goal.state === 'done' ? '✓' : goal.state === 'unresolved' ? '!' : '·' }}
                </span>
                <span class="min-w-0 text-secondary">{{ goal.title }}<span v-if="goal.detail" class="text-muted"> · {{ goal.detail }}</span></span>
              </div>
            </div>
          </Transition>
        </div>

        <div v-if="operations.length" class="flex flex-col gap-1">
          <div class="flex min-h-6 items-center px-1 text-[10px] text-muted">
            <span class="flex-1">操作记录 · {{ operations.length }}</span>
            <button v-if="operations.length > 5" type="button" class="cursor-pointer hover:text-ink"
              @click.stop="showAllOperations = !showAllOperations">
              {{ showAllOperations ? '收起' : `查看全部` }}
            </button>
          </div>
          <div v-for="operation in visibleOperations" :key="operation.id"
            class="agent-row flex min-w-0 items-center gap-2 rounded-md px-1 py-1.5 hover:bg-toolbar">
            <span class="flex h-4 w-4 shrink-0 items-center justify-center">
              <Icon v-if="operation.state === 'running'" icon="lucide:loader-2" :size="13" class="agent-spin text-accent" />
              <Icon v-else-if="operation.state === 'error'" icon="lucide:alert-circle" :size="13" class="text-danger" />
              <Icon v-else icon="lucide:check" :size="12" class="text-muted" />
            </span>
            <span class="shrink-0 text-[11px] font-medium"
              :class="operation.state === 'error' ? 'text-danger' : 'text-secondary'">{{ operation.title }}</span>
            <span v-if="operation.detail" class="h-1 w-1 shrink-0 rounded-full bg-line" />
            <span class="min-w-0 flex-1 truncate text-[10px] text-muted">{{ operation.detail }}</span>
          </div>
        </div>

        <!-- 思考内容默认收起，不再冒充当前任务状态。 -->
        <div v-if="reasoning" class="flex flex-col border-t border-line pt-1">
          <button type="button" class="flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-[11px] text-muted hover:bg-toolbar hover:text-ink"
            :aria-expanded="reasoningOpen" @click.stop="reasoningOpen = !reasoningOpen">
            <Icon icon="lucide:sparkles" :size="13" />
            <span class="flex-1 text-left">查看思考详情</span>
            <Icon icon="lucide:chevron-down" :size="12" class="agent-chevron shrink-0"
              :class="reasoningOpen ? '' : '-rotate-90'" />
          </button>
          <Transition name="agent-reveal">
            <p v-if="reasoningOpen" class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words px-1 pb-1 pl-6 text-[11px] leading-5 text-secondary">{{ reasoning }}</p>
          </Transition>
        </div>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
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

const detailsOpen = ref(false)
const goalsOpen = ref(false)
const reasoningOpen = ref(false)
const showAllOperations = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

// 只在运行期间刷新耗时；开始时展开过程，结束后自动收起为结果摘要。
watch(() => [props.running, props.startedAt], () => {
  clearInterval(timer)
  now.value = Date.now()
  if (props.running) timer = setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })
watch(() => props.startedAt, () => {
  detailsOpen.value = true
  goalsOpen.value = false
  reasoningOpen.value = false
  showAllOperations.value = false
})
watch(() => props.running, (running, previous) => {
  if (!running && previous) detailsOpen.value = false
})
onBeforeUnmount(() => clearInterval(timer))

const elapsed = computed(() => Math.max(0, Math.floor(((props.endedAt || now.value) - props.startedAt) / 1000)))
const completedGoals = computed(() => props.goals.filter(goal => goal.state === 'done').length)
const currentStage = computed(() => props.stages.find(stage => stage.state === 'running'))
const runningOperation = computed(() => props.operations.find(operation => operation.state === 'running'))
const visibleOperations = computed(() => showAllOperations.value ? props.operations : props.operations.slice(-5))
const goalSummary = computed(() => props.running ? `${props.goals.length} 项任务目标` : `${completedGoals.value}/${props.goals.length} 项已完成`)

const primaryTitle = computed(() => {
  if (props.running) return runningOperation.value?.title ?? currentStage.value?.title ?? '正在处理下一步'
  if (props.status === 'error' || props.status === 'conflict') return '任务未完成'
  if (props.status === 'cancelled') return '任务已停止'
  if (props.outcome === 'incomplete') return '任务已结束，仍有未完成事项'
  return '任务处理完成'
})
const primaryDetail = computed(() => {
  if (props.running) return runningOperation.value?.detail || currentStage.value?.detail || (props.step ? `第 ${props.step}/${props.maxSteps} 轮` : '正在建立任务计划')
  if (props.status === 'error' || props.status === 'conflict') return '查看下方错误信息后可重新执行'
  if (props.status === 'cancelled') return `已保留 ${props.operations.length} 条操作记录`
  return props.goals.length ? `${completedGoals.value}/${props.goals.length} 项目标完成 · ${props.operations.length} 次操作` : `${props.operations.length} 次操作`
})
const statusTone = computed(() => {
  if (props.status === 'error' || props.status === 'conflict') return 'border-danger text-danger'
  if (props.running) return 'border-accent text-accent'
  return 'border-line text-secondary'
})
</script>

<style scoped>
/* 用户明确要求运行反馈动画；仅动画状态变化，静态布局仍完全由 Tailwind 控制。 */
.agent-spin {
  animation: agent-spin 0.9s linear infinite;
}

.agent-pulse {
  animation: agent-pulse 1.8s ease-in-out infinite;
}

.agent-row {
  animation: agent-reveal 160ms ease-out;
}

.agent-chevron {
  transition: transform 120ms ease;
}

.agent-reveal-enter-active {
  animation: agent-reveal 160ms ease-out;
}

.agent-reveal-leave-active {
  animation: agent-hide 120ms ease-in;
}

@keyframes agent-spin {
  to { transform: rotate(360deg); }
}

@keyframes agent-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

@keyframes agent-reveal {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes agent-hide {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-3px); }
}

@media (prefers-reduced-motion: reduce) {
  .agent-spin,
  .agent-pulse,
  .agent-row,
  .agent-chevron,
  .agent-reveal-enter-active,
  .agent-reveal-leave-active {
    animation: none;
    transition: none;
  }
}
</style>
