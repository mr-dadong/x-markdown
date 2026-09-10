<template>
  <!-- 建议卡：unified diff 逐行展示删除与新增，审阅决定就地更新。 -->
  <section class="flex flex-col gap-2 rounded-lg border border-line bg-panel p-3"
    :class="patch.decision === 'pending' ? '' : 'opacity-70'">
    <div class="flex items-start justify-between gap-2">
      <p class="min-w-0 flex-1 text-xs font-medium leading-5 text-ink">{{ index + 1 }}. {{ patch.reason }}</p>
      <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px]" :class="decisionTone">{{ decisions[patch.decision] }}</span>
    </div>
    <span class="text-[11px] text-muted">修改前 · 字符 {{ patch.start }}–{{ patch.end }}</span>
    <!-- diff 主体：删除行红底、新增行绿底、上下文行保持底色 -->
    <div class="flex flex-col overflow-hidden rounded-md border border-line font-mono text-xs leading-5">
      <div v-for="(line, lineIndex) in visibleLines" :key="lineIndex" class="flex min-w-0 gap-2 px-2 py-0.5"
        :class="line.type === 'add' ? 'bg-success-soft text-success' : line.type === 'remove' ? 'bg-danger-soft text-danger' : 'bg-toolbar text-secondary'">
        <span class="shrink-0 select-none">{{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ' }}</span>
        <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{{ line.text }}</span>
      </div>
    </div>
    <!-- 长 diff 默认折叠，避免多张建议卡形成超长滚动。 -->
    <button v-if="lines.length > collapseLines" type="button"
      class="flex cursor-pointer self-start text-[11px] text-secondary hover:text-ink"
      :aria-expanded="expanded" @click="expanded = !expanded">
      {{ expanded ? '收起' : `展开全部 ${lines.length} 行` }}
    </button>
    <div v-if="patch.decision === 'pending' && canReview" class="flex justify-end gap-2">
      <button type="button" class="cursor-pointer rounded px-3 py-1 text-xs text-secondary hover:bg-toolbar"
        @click="emit('reject', patch.id)">拒绝</button>
      <button type="button" class="cursor-pointer rounded border border-accent px-3 py-1 text-xs text-accent hover:bg-selected"
        @click="emit('accept', patch.id)">接受</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { diffLines } from '../../utils/diffLines'
import type { DocumentPatch } from '../../types/documentAgent'

type Decision = 'pending' | 'accepted' | 'rejected'

const props = defineProps<{
  patch: DocumentPatch & { decision: Decision }
  index: number
  canReview: boolean
}>()
const emit = defineEmits<{ accept: [id: string]; reject: [id: string] }>()

// 超过该行数默认折叠，展开后一次看全。
const collapseLines = 12
const expanded = ref(false)

const lines = computed(() => diffLines(props.patch.before, props.patch.after))
const visibleLines = computed(() => expanded.value ? lines.value : lines.value.slice(0, collapseLines))

const decisions: Record<Decision, string> = { pending: '待审阅', accepted: '已接受', rejected: '已拒绝' }
const decisionTone = computed(() => {
  if (props.patch.decision === 'accepted') return 'bg-success-soft text-success'
  if (props.patch.decision === 'rejected') return 'bg-danger-soft text-danger'
  return 'bg-selected text-secondary'
})
</script>
