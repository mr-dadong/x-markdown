<template>
  <!-- 时间线：条目按事件到达顺序排列，思考/工具/回复/建议 interleaving 实时呈现。 -->
  <div class="flex flex-col gap-3">
    <template v-for="(entry, index) in timeline" :key="entry.id">
      <!-- 思考：写入中默认展开，结束后默认收起，只作为过程信息。 -->
      <div v-if="entry.kind === 'thinking'" class="flex flex-col">
        <button type="button"
          class="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[11px] text-muted hover:bg-toolbar hover:text-ink"
          :aria-expanded="thinkingOpen(entry, index)" @click="toggle(entry.id)">
          <Icon icon="lucide:sparkles" :size="13" class="shrink-0" />
          <span class="shrink-0">{{ running && index === timeline.length - 1 ? '正在思考' : '思考详情' }}</span>
          <!-- 收起时用首行内容做摘要，多条思考行不再长得一模一样。 -->
          <span v-if="!thinkingOpen(entry, index)" class="min-w-0 flex-1 truncate text-left text-muted">{{ firstLine(entry.text) }}</span>
          <span v-else class="min-w-0 flex-1"></span>
          <Icon icon="lucide:chevron-down" :size="12" class="shrink-0"
            :class="thinkingOpen(entry, index) ? '' : '-rotate-90'" />
        </button>
        <p v-if="thinkingOpen(entry, index)"
          :ref="el => setStreamEl(entry.id, el)"
          class="scrollbar-hide max-h-48 overflow-y-auto whitespace-pre-wrap break-words px-1 py-1 text-[11px] leading-5 text-secondary"
          @scroll="handleStreamScroll(entry.id, $event)">{{ entry.text }}</p>
      </div>

      <!-- 回复正文：流式 Markdown 渲染。 -->
      <AgentMarkdownStream v-else-if="entry.kind === 'text'" :text="entry.text" />

      <!-- 工具行：实时状态 + 耗时；展开看进展日志与仍在接收的参数流。 -->
      <div v-else-if="entry.kind === 'tool'" class="flex flex-col">
        <button type="button"
          class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-toolbar"
          :aria-expanded="toolOpen(entry)" @click="toggle(entry.id)">
          <span class="flex h-4 w-4 shrink-0 items-center justify-center">
            <Icon v-if="entry.operation.state === 'running'" icon="lucide:loader-2" :size="13" class="animate-spin text-accent" />
            <Icon v-else-if="entry.operation.state === 'error'" icon="lucide:alert-circle" :size="13" class="text-danger" />
            <Icon v-else icon="lucide:check" :size="12" class="text-muted" />
          </span>
          <span class="shrink-0 text-[11px] font-medium"
            :class="entry.operation.state === 'error' ? 'text-danger' : 'text-ink'">{{ entry.operation.title }}</span>
          <span class="min-w-0 flex-1 truncate text-[10px] text-muted">{{ entry.operation.detail || latestLog(entry) }}</span>
          <span v-if="entry.operation.endedAt" class="shrink-0 text-[10px] text-muted">{{ duration(entry.operation) }}</span>
          <Icon icon="lucide:chevron-down" :size="12" class="shrink-0 text-muted"
            :class="toolOpen(entry) ? '' : '-rotate-90'" />
        </button>
        <div v-if="toolOpen(entry)" class="flex flex-col gap-1 py-1 pl-7 pr-1">
          <p v-for="(log, logIndex) in entry.logs" :key="logIndex" class="text-[10px] leading-4 text-muted">{{ log }}</p>
          <!-- 参数流仍在接收时实时展示，工具结束后自动清空。 -->
          <pre v-if="entry.draft" :ref="el => setStreamEl(`draft-${entry.id}`, el)"
            class="scrollbar-hide max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-selected p-2 font-mono text-xs leading-5 text-ink"
            @scroll="handleStreamScroll(`draft-${entry.id}`, $event)">{{ entry.draft }}</pre>
        </div>
      </div>

      <!-- 无归属工具的重要提示。 -->
      <p v-else-if="entry.kind === 'notice'" class="flex items-start gap-1.5 px-1 text-[10px] leading-4 text-muted">
        <Icon icon="lucide:info" :size="12" class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1">{{ entry.message }}</span>
      </p>

      <!-- 建议卡：按到达位置内联出现，审阅决定就地更新。 -->
      <AgentPatchCard v-else-if="entry.kind === 'patch' && patchOf(entry.patchId)"
        :patch="patchOf(entry.patchId)!" :index="patchIndex(entry.patchId)" :can-review="canReview"
        @accept="id => emit('accept', id)" @reject="id => emit('reject', id)" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { DocumentAgentOperation, DocumentAgentTimelineEntry, DocumentPatch } from '../../types/documentAgent'
import AgentMarkdownStream from './AgentMarkdownStream.vue'
import AgentPatchCard from './AgentPatchCard.vue'

type ReviewPatch = DocumentPatch & { decision: 'pending' | 'accepted' | 'rejected' }
type ToolEntry = Extract<DocumentAgentTimelineEntry, { kind: 'tool' }>

const props = defineProps<{
  timeline: DocumentAgentTimelineEntry[]
  patches: ReviewPatch[]
  canReview: boolean
  running: boolean
}>()
const emit = defineEmits<{ accept: [id: string]; reject: [id: string] }>()

// 用户手动展开/收起的记录；未记录时使用各类条目的默认规则。
const openOverrides = ref<Record<string, boolean>>({})
const toggle = (id: string): void => {
  openOverrides.value[id] = !openOverrides.value[id]
}
// 思考默认规则：正在写入的最后一条展开，其余收起。
const thinkingOpen = (entry: Extract<DocumentAgentTimelineEntry, { kind: 'thinking' }>, index: number): boolean =>
  openOverrides.value[entry.id] ?? (props.running && index === props.timeline.length - 1)
// 工具行默认规则：参数流接收中自动展开，结束后收起。
const toolOpen = (entry: ToolEntry): boolean => openOverrides.value[entry.id] ?? entry.draft !== ''

const latestLog = (entry: ToolEntry): string => entry.logs[entry.logs.length - 1] ?? ''

// ─── 流式区域贴底跟随：思考文本与工具参数流长到溢出时，贴底才自动下拉 ───

/** 流式区域内距底部多少像素内视为「贴底」，此范围内新内容才自动跟随 */
const STREAM_NEAR_BOTTOM_THRESHOLD = 24
// 流式区域元素引用（思考用条目 id、参数流用 draft-前缀），卸载时回调传 null 自动移除。
const streamEls: Record<string, HTMLElement> = {}
const setStreamEl = (id: string, el: unknown): void => {
  if (el instanceof HTMLElement) streamEls[id] = el
  else delete streamEls[id]
}
// 每个流式区域是否贴底：用户上翻查看前文时不被拽回。
const streamNearBottom = ref<Record<string, boolean>>({})
const handleStreamScroll = (id: string, event: Event): void => {
  const el = event.target as HTMLElement
  streamNearBottom.value[id] = el.scrollHeight - el.scrollTop - el.clientHeight < STREAM_NEAR_BOTTOM_THRESHOLD
}
// 流式内容长度签名：思考或参数流任一增长都会变化，触发贴底跟随。
const streamSignature = computed(() => props.timeline.map(entry => {
  if (entry.kind === 'thinking') return entry.text.length
  if (entry.kind === 'tool') return entry.draft.length
  return 0
}).join(','))
watch(streamSignature, () => {
  for (const [id, el] of Object.entries(streamEls)) {
    if (streamNearBottom.value[id] ?? true) el.scrollTop = el.scrollHeight
  }
}, { flush: 'post' })
// 思考文本首行，作为收起状态的单行摘要。
const firstLine = (text: string): string => text.split('\n')[0]
// 耗时不足 1 秒时显示毫秒：本地工具瞬间完成，显示 0.0 秒会像坏了。
// 本地登记类工具实测不足 1 毫秒，显示「<1 毫秒」比「0 毫秒」更符合直觉。
const duration = (operation: DocumentAgentOperation): string => {
  const ms = (operation.endedAt ?? operation.startedAt) - operation.startedAt
  if (ms < 1) return '<1 毫秒'
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`
}

const patchOf = (id: string): ReviewPatch | undefined => props.patches.find(patch => patch.id === id)
const patchIndex = (id: string): number => props.patches.findIndex(patch => patch.id === id)
</script>
