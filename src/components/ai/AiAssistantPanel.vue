<template>
  <aside class="fixed right-3 top-16 bottom-12 z-40 flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-2xl shadow-black/10">
    <header class="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-selected text-accent">
          <Icon icon="lucide:sparkles" :size="15" />
        </span>
        <div class="min-w-0">
          <h2 class="truncate text-[13px] font-semibold text-ink">AI 助手</h2>
          <p class="truncate text-[10px] text-muted">{{ statusMessage }}</p>
        </div>
      </div>
      <button type="button" title="关闭 AI 助手"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @click="emit('close')">
        <Icon icon="lucide:x" :size="16" />
      </button>
    </header>

    <!-- AI 未配置：引导用户前往设置页配置。 -->
    <div v-if="!aiReady" class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-selected text-muted">
        <Icon icon="lucide:sparkles" :size="28" />
      </span>
      <div class="flex flex-col gap-1.5">
        <p class="text-[14px] font-semibold text-ink">尚未配置 AI</p>
        <p class="text-[12px] leading-5 text-secondary">需要先设置模型提供方和 API Key，才能使用 AI 助手处理文本。</p>
      </div>
      <button type="button"
        class="flex h-9 items-center gap-2 rounded-md bg-accent px-5 text-[13px] font-semibold text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        @mousedown.prevent="emit('open-settings')">
        <Icon icon="lucide:settings" :size="15" />
        前往设置
      </button>
    </div>

    <!-- AI 已配置：正常展示动作面板。 -->
    <template v-else>
      <div class="editor-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div class="grid grid-cols-3 gap-1.5">
          <button v-for="action in actions" :key="action.id" type="button"
            class="flex h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-line bg-panel px-1 text-secondary hover:border-accent hover:bg-selected hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            :class="{ 'border-accent bg-selected text-accent': currentAction === action.id }"
            :disabled="isStreaming" @click="runAction(action.id, instruction)">
            <Icon :icon="action.icon" :size="16" class="shrink-0" />
            <span class="max-w-full truncate text-[11px] font-medium">{{ action.label }}</span>
          </button>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="ai-instruction" class="text-[11px] font-medium text-muted">额外要求</label>
          <textarea id="ai-instruction" v-model="instruction" rows="2"
            placeholder="例如：面向初级读者，保留术语"
            class="w-full resize-none rounded-md border border-line bg-panel px-3 py-2 text-[12px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            @keydown.enter.exact.prevent="submitWithInstruction" />
        </div>

        <div class="flex min-h-0 flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-medium text-muted">结果</span>
            <div class="flex items-center gap-1">
              <button v-if="isStreaming" type="button" title="停止生成"
                class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                @click="cancel">
                <Icon icon="lucide:square" :size="12" />
              </button>
              <button v-else-if="status === 'error'" type="button" title="重试"
                class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                @click="retry">
                <Icon icon="lucide:rotate-ccw" :size="14" />
              </button>
              <button v-if="result && !isStreaming" type="button" title="复制结果"
                class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                @click="copyResult">
                <Icon icon="lucide:copy" :size="14" />
              </button>
            </div>
          </div>
          <pre
            class="editor-scroll max-h-[300px] min-h-[120px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel p-3 font-mono text-[12px] leading-5 text-secondary">{{ displayedResult }}</pre>
        </div>
      </div>

      <footer class="flex h-12 shrink-0 items-center gap-2 border-t border-line bg-panel px-3">
        <button type="button"
          class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-paper text-[12px] font-medium text-secondary hover:bg-control-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canInsert" @click="insertResult(false)">
          <Icon icon="lucide:corner-down-left" :size="14" />
          插入
        </button>
        <button type="button"
          class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-paper text-[12px] font-medium text-secondary hover:bg-control-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canReplace" @click="insertResult(true)">
          <Icon icon="lucide:replace" :size="14" />
          替换选区
        </button>
      </footer>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { useAiAssistant } from '../../composables/useAiAssistant'
import { useAiStatus } from '../../composables/useAiStatus'
import type { AiEditAction } from '../../types/ai'

const props = defineProps<{
  getSelection: () => string
  getDocumentContext: () => string
  applyResult: (text: string, replaceSelection: boolean) => void
  initialAction?: AiEditAction | null
}>()

const emit = defineEmits<{ close: []; 'action-executed': []; 'open-settings': [] }>()

const { status: aiStatus, isConfigured } = useAiStatus()
const aiReady = computed(() => isConfigured())

const {
  isStreaming,
  status,
  result,
  error,
  currentAction,
  runAction,
  retry,
  cancel,
  copyResult,
  insertResult,
  clearResult,
} = useAiAssistant({
  getSelection: props.getSelection,
  getDocumentContext: props.getDocumentContext,
  applyResult: props.applyResult,
})

const instruction = ref('')

const actions: { id: AiEditAction; label: string; icon: string }[] = [
  { id: 'polish', label: '润色', icon: 'lucide:wand-2' },
  { id: 'rewrite', label: '重写', icon: 'lucide:refresh-cw' },
  { id: 'summarize', label: '总结', icon: 'lucide:list' },
  { id: 'translate', label: '翻译', icon: 'lucide:languages' },
  { id: 'continue', label: '续写', icon: 'lucide:pen-line' },
  { id: 'explain-code', label: '解释代码', icon: 'lucide:code-2' },
  { id: 'fix-code', label: '修复代码', icon: 'lucide:wrench' },
  { id: 'outline', label: '大纲', icon: 'lucide:list-tree' },
  { id: 'toc', label: '目录', icon: 'lucide:list' },
  { id: 'table', label: '表格', icon: 'lucide:table-2' },
  { id: 'callout', label: '提示块', icon: 'lucide:info' },
  { id: 'mermaid', label: 'Mermaid', icon: 'lucide:workflow' },
  { id: 'frontmatter', label: '元数据', icon: 'lucide:braces' },
]

// 从选区工具栏进入时自动执行指定动作，无需用户再点一次。
onMounted(() => {
  if (props.initialAction && aiReady.value) {
    void runAction(props.initialAction, instruction.value)
    emit('action-executed')
  }
})

const displayedResult = computed(() => {
  if (error.value) return error.value
  if (result.value) return result.value
  if (status.value === 'streaming') return '正在生成…'
  return '选择上方动作开始'
})

const canInsert = computed(() => Boolean(result.value) && !isStreaming.value)
const canReplace = computed(
  () => Boolean(props.getSelection()) && Boolean(result.value) && !isStreaming.value,
)

const statusMessage = computed(() => {
  if (!aiReady.value) return '需要配置 AI'
  if (isStreaming.value) return '正在生成'
  if (status.value === 'error') return '生成失败'
  if (status.value === 'done') return '生成完成'
  if (props.getSelection()) return '已识别当前选区'
  return '可处理选中文本或当前文档'
})

const submitWithInstruction = (): void => {
  if (!currentAction.value) return
  void runAction(currentAction.value, instruction.value)
}
</script>
