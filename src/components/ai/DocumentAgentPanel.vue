<template>
  <!-- 任务区按阅读顺序展示目标、操作记录和待审阅改动。 -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex min-h-0 flex-1 select-text flex-col gap-4 overflow-y-auto px-3 py-4">
      <div v-if="status === 'idle'" class="flex flex-col gap-3 rounded-lg border border-line p-4">
        <span class="text-sm font-semibold text-ink">让 AI 直接整理当前文档</span>
        <p class="text-xs leading-6 text-secondary">AI 会读取、搜索并提出局部修改。你查看修改前后，再决定是否写入。</p>
        <button type="button" class="flex rounded-md border border-line px-3 py-2 text-left text-xs text-secondary hover:bg-selected" @click="send('检查标题层级和术语一致性，只修改必要位置，保留代码块。')">检查标题与术语，保留代码块</button>
      </div>
      <div v-if="instruction" class="flex flex-col gap-2">
        <span class="text-[11px] text-muted">本次任务 · {{ outcome === 'incomplete' && canReview ? '仍有未完成事项' : labels[status] }}</span>
        <p class="whitespace-pre-wrap break-words text-sm text-ink">{{ instruction }}</p>
      </div>
      <AgentExecutionStatus v-if="status !== 'idle'" :running="running" :status="status" :outcome="outcome"
        :stages="stages" :operations="operations" :goals="goals" :reasoning="reasoning"
        :started-at="startedAt" :ended-at="endedAt" :step="step" :max-steps="maxSteps" :task-ms="taskMs" :budget-message="budgetMessage" />
      <!-- 检查完成前允许查看建议，但不能将中断任务的内容写入文档。 -->
      <p v-if="patches.length && !canReview" class="rounded-lg border border-line px-3 py-2 text-xs leading-5 text-muted">{{ running ? '建议正在生成，最终检查后可审阅应用。' : '任务未完成，以下建议尚未通过最终核对，仅供查看。' }}</p>
      <p v-if="response" class="whitespace-pre-wrap break-words text-xs leading-6 text-secondary">{{ response }}</p>
      <div v-if="error" role="alert" class="flex flex-col gap-2 rounded-md border border-danger p-3 text-xs leading-5 text-danger">
        <p>{{ error }}</p>
        <button v-if="instruction && canStart" type="button" class="flex self-start rounded border border-line px-2 py-1 text-secondary hover:bg-selected" @click="send(instruction)">重新读取并执行</button>
      </div>
      <p v-if="status === 'cancelled'" class="text-xs text-muted">任务已停止，本轮建议不可应用。已保存的文档内容未受影响。</p>
      <div v-if="patches.length" class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-semibold text-ink">{{ patches.length }} 处建议 · {{ pending.length }} 处待审阅</span>
          <div v-if="canReview && pending.length" class="flex gap-2">
            <button type="button" class="rounded px-2 py-1 text-xs text-muted hover:bg-selected" @click="reject()">全部拒绝</button>
            <button type="button" class="rounded bg-accent px-2 py-1 text-xs text-inverse hover:bg-accent-strong" @click="accept()">全部接受</button>
          </div>
        </div>
        <div v-for="(patch, index) in patches" :key="patch.id" class="flex flex-col gap-2 rounded-lg border border-line p-3">
          <div class="flex items-start justify-between gap-2">
            <p class="text-xs font-medium leading-5 text-ink">{{ index + 1 }}. {{ patch.reason }}</p>
            <span class="shrink-0 text-[11px] text-muted">{{ decisions[patch.decision] }}</span>
          </div>
          <!-- 原文与新内容以纯文本展示，不能执行文档中的 HTML。 -->
          <span class="text-[11px] text-muted">修改前 · 字符 {{ patch.start }}–{{ patch.end }}</span>
          <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-toolbar p-2 font-mono text-xs leading-5 text-secondary">{{ patch.before || '（此处插入）' }}</pre>
          <span class="text-[11px] text-accent">修改后</span>
          <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-selected p-2 font-mono text-xs leading-5 text-ink">{{ patch.after || '（删除这段内容）' }}</pre>
          <div v-if="patch.decision === 'pending' && canReview" class="flex justify-end gap-2">
            <button type="button" class="rounded px-3 py-1 text-xs text-secondary hover:bg-toolbar" @click="reject(patch.id)">拒绝</button>
            <button type="button" class="rounded border border-accent px-3 py-1 text-xs text-accent hover:bg-selected" @click="accept(patch.id)">接受</button>
          </div>
        </div>
      </div>
      <div v-if="canReview" class="flex flex-col gap-2 text-xs leading-5 text-muted">
        <span>结构检查 · {{ checkTarget }}</span>
        <p>{{ issues.length ? '发现以下问题：' : '未发现标题跳级或未闭合代码围栏。' }}</p>
        <p v-for="issue in issues" :key="issue">{{ issue }}</p>
        <span>检查不包含文章事实。接受的修改会进入编辑器撤销历史。</span>
        <button v-if="accepted.length" type="button" class="flex self-start rounded border border-line px-3 py-1 text-secondary hover:bg-selected" @click="undo">撤销本次任务的修改</button>
      </div>
    </div>
    <p v-if="canReview && pending.length" class="px-3 pt-2 text-[11px] text-muted">请先接受或拒绝本轮建议，再开始下一项任务。</p>
    <p v-if="running" class="px-3 pt-2 text-[11px] leading-5 text-muted">{{ stages.find(stage => stage.state === 'running')?.title ?? '模型正在处理下一步' }} · 已生成 {{ patches.length }} 处建议 · 可随时停止</p>
    <AiChatInput ref="input" :is-streaming="running" :disabled="!canStart && !running" @send="send" @cancel="cancel">
      <template #footer-left><slot name="footer-left" /></template>
      <template #footer-right><slot name="footer-right" :busy="running || settling" /></template>
    </AiChatInput>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDocumentAgent } from '../../composables/useDocumentAgent'
import type { DocumentAgentOptions } from '../../composables/useDocumentAgent'
import AiChatInput from './AiChatInput.vue'
import AgentExecutionStatus from './AgentExecutionStatus.vue'

// 父级提供编辑器操作，面板本身不接触磁盘文件。
const props = defineProps<{ options: DocumentAgentOptions }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const { status, instruction, response, reasoning, stages, operations, goals, outcome, startedAt, endedAt, step, maxSteps, taskMs, budgetMessage, patches, issues, checkTarget, error, running, settling, pending, accepted,
  canReview, canStart, start, cancel, accept, reject, undo } = useDocumentAgent(props.options)
const input = ref<InstanceType<typeof AiChatInput> | null>(null)
const labels = { idle: '就绪', running: '执行中', review: '等待审阅', done: '已完成', cancelled: '已停止', error: '失败', conflict: '文档已变化' }
const decisions = { pending: '待审阅', accepted: '已接受', rejected: '已拒绝' }
watch(() => running.value || settling.value, value => emit('busy', value))
const send = async (text: string): Promise<void> => {
  if (await start(text)) input.value?.clearDraft(text)
}
</script>
