<template>
  <!-- 任务摘要卡：单行展示当前状态，过程细节已交给时间线，这里只保留计划级信息。 -->
  <section class="flex min-w-0 flex-col rounded-xl border border-line bg-panel px-3 py-2.5">
    <button type="button"
      class="flex min-w-0 cursor-pointer items-center gap-3 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
        :class="statusTone">
        <Icon v-if="running" icon="lucide:loader-2" :size="15" class="agent-spin" />
        <Icon v-else-if="status === 'error' || status === 'conflict'" icon="lucide:alert-circle" :size="15" />
        <Icon v-else-if="status === 'cancelled'" icon="lucide:square" :size="13" />
        <!-- 部分完成不是成功也不是失败：用提醒图标，避免未完成却显示对勾。 -->
        <Icon v-else-if="outcome === 'incomplete'" icon="lucide:alert-circle" :size="15" />
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
        <p v-if="totalBatches" class="rounded-md bg-toolbar px-2 py-1.5 text-[10px] leading-4 text-secondary">批次 {{ batch }}/{{ totalBatches }} · 已核对 {{ completedBlocks }} 块 · 剩余 {{ remainingBlocks }} 块 · 截断恢复 {{ truncationRecoveries }} 次</p>

        <!-- 五个固定阶段让用户一眼看懂已完成、正在做和下一步。 -->
        <div class="flex flex-col gap-1">
          <span class="px-1 text-[10px] text-muted">执行阶段</span>
          <div v-for="item in stages" :key="item.id" class="flex min-w-0 items-start gap-2 rounded-md px-1 py-1 text-[11px]">
            <span class="flex h-5 w-4 shrink-0 items-center justify-center" :class="stageTone(item.state)">
              <Icon v-if="item.state === 'running'" icon="lucide:loader-2" :size="12" class="agent-spin" />
              <span v-else>{{ stageMark(item.state) }}</span>
            </span>
            <span class="shrink-0 font-medium text-secondary">{{ item.title }}</span>
            <span class="min-w-0 flex-1 text-muted">{{ item.detail || stageDescription(item.state) }}</span>
          </div>
        </div>

        <!-- 计划位于阶段之后，展示模型报告的目标完成情况。 -->
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
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { DocumentAgentGoal, DocumentAgentStage } from '../../types/documentAgent'

const props = defineProps<{
  running: boolean
  status: string
  outcome: 'complete' | 'incomplete' | null
  stages: Array<{ id: DocumentAgentStage; title: string; state: 'pending' | 'running' | 'done' | 'interrupted' | 'skipped'; detail: string }>
  goals: DocumentAgentGoal[]
  startedAt: number
  endedAt: number
  step: number
  maxSteps: number
  taskMs: number
  budgetMessage: string
  batch: number
  totalBatches: number
  completedBlocks: number
  remainingBlocks: number
  truncationRecoveries: number
  currentActionTitle: string
  currentActionDetail: string
}>()

const detailsOpen = ref(false)
const goalsOpen = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

// 只在运行期间刷新耗时；开始时收起过程，结束后自动收起为结果摘要。
watch(() => [props.running, props.startedAt], () => {
  clearInterval(timer)
  now.value = Date.now()
  if (props.running) timer = setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })
watch(() => props.startedAt, () => {
  detailsOpen.value = false
  goalsOpen.value = false
})
watch(() => props.running, (running, previous) => {
  if (!running && previous) detailsOpen.value = false
})
onBeforeUnmount(() => clearInterval(timer))

const elapsed = computed(() => Math.max(0, Math.floor(((props.endedAt || now.value) - props.startedAt) / 1000)))
const completedGoals = computed(() => props.goals.filter(goal => goal.state === 'done').length)
const currentStage = computed(() => props.stages.find(stage => stage.state === 'running'))
const goalSummary = computed(() => props.running ? `${props.goals.length} 项任务目标` : `${completedGoals.value}/${props.goals.length} 项已完成`)

const primaryTitle = computed(() => {
  if (props.status === 'stopping') return '正在停止任务'
  if (props.running) return props.currentActionTitle || currentStage.value?.title || '正在处理下一步'
  if (props.status === 'error' || props.status === 'conflict') return '任务未完成'
  if (props.status === 'cancelled') return '任务已停止'
  if (props.outcome === 'incomplete') return '任务已结束，仍有未完成事项'
  return '任务处理完成'
})
const primaryDetail = computed(() => {
  if (props.status === 'stopping') return '等待后台结束并核对已生成建议'
  if (props.running) return props.currentActionDetail || currentStage.value?.detail || (props.step ? `第 ${props.step}/${props.maxSteps} 轮` : '正在建立任务计划')
  if (props.status === 'error' || props.status === 'conflict') return '查看下方错误信息后可重新执行'
  return props.goals.length ? `${completedGoals.value}/${props.goals.length} 项目标完成` : '没有待处理事项'
})
const statusTone = computed(() => {
  if (props.status === 'error' || props.status === 'conflict') return 'border-danger text-danger'
  if (props.running) return 'border-accent text-accent'
  return 'border-line text-secondary'
})
const stageMark = (state: string): string => state === 'done' ? '✓' : state === 'interrupted' ? '!' : state === 'skipped' ? '–' : '·'
const stageTone = (state: string): string => state === 'running' ? 'text-accent' : state === 'interrupted' ? 'text-danger' : 'text-muted'
const stageDescription = (state: string): string => state === 'pending' ? '等待执行' : state === 'skipped' ? '本次未执行' : ''
</script>

<style scoped>
/* 用户明确要求运行反馈动画；仅动画状态变化，静态布局仍完全由 Tailwind 控制。 */
.agent-spin {
  animation: agent-spin 0.9s linear infinite;
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
  .agent-chevron,
  .agent-reveal-enter-active,
  .agent-reveal-leave-active {
    animation: none;
    transition: none;
  }
}
</style>
