<template>
  <!-- 任务区按阅读顺序展示目标、执行时间线和待审阅改动。 -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div ref="scrollRef" class="editor-scroll flex min-h-0 flex-1 select-text flex-col gap-4 overflow-y-auto px-3 py-4" @scroll="handleScroll">
        <!-- 空状态沿用普通对话的居中结构，让两种模式切换时保持一致的视觉重心。 -->
        <div v-if="status === 'idle'" class="flex flex-1 flex-col items-center justify-center px-3 py-8 text-center">
          <span class="mb-4 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-accent text-inverse">
            <Icon icon="lucide:sparkles" :size="30" />
          </span>
          <p class="mb-1.5 text-[16px] font-semibold text-ink">整理当前文档</p>
          <p class="mb-5 max-w-[260px] text-[12px] leading-relaxed text-secondary">
            描述整理目标，Agent 会检查文档并提出局部修改，由你审阅后再写入。
          </p>
          <!-- 常用任务保持单列轻量入口，点击后直接开始执行。 -->
          <div class="flex w-full max-w-[260px] flex-col gap-2">
            <button v-for="action in quickActions" :key="action.label" type="button"
              class="group flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5 text-left text-[12px] text-secondary hover:bg-toolbar hover:text-ink"
              @click="send(action.prompt)">
              <span class="shrink-0 text-muted group-hover:text-accent">
                <Icon :icon="action.icon" :size="14" />
              </span>
              <span>{{ action.label }}</span>
            </button>
          </div>
        </div>
        <!-- 用户目标作为右侧消息展示，运行时间线自然接在其下方。 -->
        <div v-if="instruction" class="flex flex-col items-end gap-1.5">
          <span class="text-[10px] text-muted">你 · {{ outcome === 'incomplete' && canReview ? '仍有未完成事项' : labels[status] }}</span>
          <p class="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-selected px-3.5 py-2.5 text-[13px] leading-5 text-ink">{{ instruction }}</p>
        </div>
        <AgentExecutionStatus v-if="status !== 'idle'" :running="running" :status="status" :outcome="outcome"
          :stages="stages" :goals="goals"
          :started-at="startedAt" :ended-at="endedAt" :step="step" :max-steps="maxSteps" :task-ms="taskMs" :budget-message="budgetMessage"
          :batch="batch" :total-batches="totalBatches" :completed-blocks="completedBlocks" :remaining-blocks="remainingBlocks" :truncation-recoveries="truncationRecoveries"
          :current-action-title="currentActionTitle" :current-action-detail="currentActionDetail" />
        <!-- 时间线：思考、工具调用、回复与建议按到达顺序实时 interleaving 呈现。 -->
        <AgentTimeline v-if="status !== 'idle'" :timeline="timeline" :patches="patches" :can-review="canReview" :running="running"
          @accept="accept" @reject="reject" />
        <!-- 部分完成说明（达到预算、任务停止等）：中性配色，与真错误的红色条区分。 -->
        <div v-if="partialMessage" class="flex items-start gap-2 rounded-md border border-line bg-toolbar px-3 py-2 text-xs leading-5 text-secondary">
          <Icon icon="lucide:info" :size="13" class="mt-0.5 shrink-0" />
          <span class="min-w-0 flex-1">{{ partialMessage }}。已生成的建议保留在上方供审阅；如需核对全部内容，可提高 Agent 任务预算或缩小任务范围后重新执行。</span>
        </div>
        <div v-if="error" role="alert" class="flex flex-col gap-2 rounded-md border border-danger p-3 text-xs leading-5 text-danger">
          <p>{{ error }}</p>
          <button v-if="instruction && canStart" type="button" class="flex self-start rounded border border-line px-2 py-1 text-secondary hover:bg-selected" @click="send(instruction)">重新读取并执行</button>
        </div>
        <p v-if="status === 'cancelled'" class="text-xs text-muted">任务已停止。没有可审阅建议，已保存的文档内容未受影响。</p>
        <div v-if="canReview" class="flex flex-col gap-2 text-xs leading-5 text-muted">
          <span>结构检查 · {{ checkTarget }}</span>
          <p>{{ issues.length ? '发现以下问题：' : '未发现标题跳级或未闭合代码围栏。' }}</p>
          <p v-for="issue in issues" :key="issue">{{ issue }}</p>
          <span>检查不包含文章事实。接受的修改会进入编辑器撤销历史。</span>
          <button v-if="accepted.length" type="button" class="flex self-start rounded border border-line px-3 py-1 text-secondary hover:bg-selected" @click="undo">撤销本次任务的修改</button>
        </div>
      </div>
      <!-- 回到底部浮标：用户上翻查看历史时出现，流式内容不强行拽回视线。 -->
      <button v-if="!isNearBottom && status !== 'idle'" type="button"
        class="absolute bottom-4 right-4 z-10 flex h-7 cursor-pointer items-center gap-1 rounded-full border border-line bg-panel px-3 text-[11px] font-medium text-secondary hover:bg-toolbar hover:text-ink"
        @click="jumpToBottom">
        <Icon icon="lucide:arrow-down" :size="12" />
        <span>回到底部</span>
      </button>
    </div>
    <!-- 吸附审阅条：批量决定与进度固定在输入框上方，不必滚回卡片顶部找按钮。 -->
    <div v-if="canReview && pending.length" class="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-2">
      <span class="min-w-0 flex-1 truncate text-[11px] text-muted">{{ patches.length }} 处建议 · {{ pending.length }} 处待审阅 · 请先接受或拒绝本轮建议，再开始下一项任务</span>
      <div class="flex shrink-0 gap-2">
        <button type="button" class="cursor-pointer rounded px-2 py-1 text-xs text-muted hover:bg-selected" @click="reject()">全部拒绝</button>
        <button type="button" class="cursor-pointer rounded bg-accent px-2 py-1 text-xs text-inverse hover:bg-accent-strong" @click="accept()">全部接受</button>
      </div>
    </div>
    <p v-if="running" class="px-3 pt-2 text-[11px] leading-5 text-muted">{{ currentActionTitle || stages.find(stage => stage.state === 'running')?.title || '模型正在处理下一步' }} · 已生成 {{ patches.length }} 处建议 · 可随时停止</p>
    <AiChatInput ref="input" :is-streaming="running" :disabled="!canStart && !running" @send="send" @cancel="cancel">
      <template #footer-left><slot name="footer-left" /></template>
      <template #footer-right><slot name="footer-right" :busy="running || settling" /></template>
    </AiChatInput>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { useDocumentAgent } from '../../composables/useDocumentAgent'
import type { DocumentAgentOptions } from '../../composables/useDocumentAgent'
import AiChatInput from './AiChatInput.vue'
import AgentExecutionStatus from './AgentExecutionStatus.vue'
import AgentTimeline from './AgentTimeline.vue'

// 父级提供编辑器操作，面板本身不接触磁盘文件。
const props = defineProps<{ options: DocumentAgentOptions }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const { status, instruction, stages, goals, outcome, startedAt, endedAt, step, maxSteps, taskMs, budgetMessage, batch, totalBatches, completedBlocks, remainingBlocks, truncationRecoveries, currentActionTitle, currentActionDetail, timeline, patches, issues, checkTarget, error, partialMessage, running, settling, pending, accepted,
  canReview, canStart, start, cancel, clear, accept, reject, undo } = useDocumentAgent(props.options)
const input = ref<InstanceType<typeof AiChatInput> | null>(null)
const labels = { idle: '就绪', running: '执行中', stopping: '正在停止', review: '等待审阅', done: '已完成', cancelled: '已停止', error: '失败', conflict: '文档已变化' }
// 快捷任务只提供明确、可审阅的文档整理目标，避免用户首次进入时不知道如何描述任务。
const quickActions = [
  { icon: 'lucide:list-tree', label: '检查标题层级与结构', prompt: '检查标题层级和文档结构，只修改必要位置，保留代码块。' },
  { icon: 'lucide:spell-check', label: '统一术语与表达', prompt: '检查全文术语和表达是否一致，只修改不一致的位置，保留原意。' },
  { icon: 'lucide:wand-2', label: '精简重复和冗余内容', prompt: '检查全文重复和冗余的内容，只精简必要位置，不改变文章结构和原意。' },
]
watch(() => running.value || settling.value, value => emit('busy', value))
const send = async (text: string): Promise<void> => {
  if (await start(text)) input.value?.clearDraft(text)
}
// 标题栏通过此方法清除 Agent 记录，不直接操作面板内部状态。
defineExpose({ clear })

// ─── 自动滚动：仅当贴近底部时才跟随到底，用户上翻查看时不被强制拽回 ───

/** 距底部多少像素内视为「贴近底部」，此范围内新内容才自动滚动跟随 */
const NEAR_BOTTOM_THRESHOLD = 80
const scrollRef = ref<HTMLElement | null>(null)
const isNearBottom = ref(true)

const handleScroll = (): void => {
  const el = scrollRef.value
  if (el) isNearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD
}
const scrollToBottom = (): void => {
  nextTick(() => {
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight
      isNearBottom.value = true
    }
  })
}
const jumpToBottom = (): void => { scrollToBottom() }

// 内容签名：时间线长度、末条文本长度、建议数量与任务状态，任一变化都代表有新内容到达。
const contentSignature = computed(() => {
  const last = timeline.value[timeline.value.length - 1]
  const lastText = last && (last.kind === 'thinking' || last.kind === 'text') ? last.text.length : 0
  return `${timeline.value.length}:${lastText}:${patches.value.length}:${status.value}`
})
watch(contentSignature, () => {
  if (isNearBottom.value) scrollToBottom()
})
// 新任务开始时直接回到底部，从空白或上一轮末尾开始跟随。
watch(startedAt, () => {
  isNearBottom.value = true
  scrollToBottom()
})
</script>
