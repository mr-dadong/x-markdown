<template>
  <!-- AI 聊天侧栏：macOS 风格，发丝线分隔加柔和圆角 -->
  <aside
    v-show="sidebarOpen"
    class="relative flex h-full min-w-[320px] max-w-[560px] shrink-0 flex-col border-l border-line bg-paper select-none"
    :class="{ 'pointer-events-none': isResizing }"
    :style="{ width: sidebarWidth + 'px' }"
  >
    <!-- 拖拽调整宽度：左侧隐形窄条，悬停时高亮 -->
    <div class="absolute -left-[3px] bottom-0 top-0 z-10 w-1.5 cursor-col-resize hover:bg-control-active" @mousedown="startResize" />

    <!-- 头部：图标 + 标题状态 + 操作按钮 -->
    <header class="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
      <div class="flex min-w-0 items-center gap-2">
        <!-- AI 图标：柔和圆角方块 -->
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-selected text-accent">
          <Icon icon="lucide:sparkles" :size="15" />
        </span>
        <div class="min-w-0">
          <h2 class="text-[13px] font-semibold leading-tight text-ink">{{ mode === 'agent' ? '文档 Agent' : 'AI Chat' }}</h2>
          <span class="text-[11px] leading-tight text-muted">{{ statusText }}</span>
        </div>
      </div>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-toolbar hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          :title="mode === 'agent' ? '清空 Agent 记录' : '清空对话'"
          :disabled="mode === 'agent' && agentBusy"
          @mousedown.prevent="handleClear"
        >
          <Icon icon="lucide:trash-2" :size="13" />
        </button>
        <button
          type="button"
          class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-toolbar hover:text-ink"
          title="关闭"
          @mousedown.prevent="emit('close')"
        >
          <Icon icon="lucide:x" :size="14" />
        </button>
      </div>
    </header>

    <!-- AI 未配置 -->
    <div v-if="!aiReady" class="flex flex-1 flex-col items-center justify-center p-6 text-center">
      <span class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-selected text-muted">
        <Icon icon="lucide:sparkles" :size="28" />
      </span>
      <p class="mb-1.5 text-[14px] font-semibold text-ink">尚未配置 AI</p>
      <p class="mb-4 text-[12px] leading-relaxed text-secondary">需要先设置模型提供方和 API Key，才能使用 AI Chat。</p>
      <button
        type="button"
        class="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-inverse hover:bg-accent-strong"
        @mousedown.prevent="emit('open-settings')"
      >
        <Icon icon="lucide:settings" :size="15" />
        <span>前往设置</span>
      </button>
    </div>

    <!-- 对话区域 -->
    <template v-else>
      <DocumentAgentPanel ref="agentPanelRef" v-show="mode === 'agent'" :options="agentOptions" @busy="agentBusy = $event">
        <template #footer-left>
          <AiModeSelector v-model="mode" :disabled="isStreaming || agentBusy" />
        </template>
        <template #footer-right="{ busy }">
          <AiChatModelSelector :current="selectedModel" :default-model="defaultModel" :models="modelList"
            :custom-models="customModelList" :loading="modelsLoading" :error="modelsError" :disabled="busy"
            @select="handleModelSelect" @refresh="emit('open-settings')" />
        </template>
      </DocumentAgentPanel>
      <div v-show="mode === 'chat'" class="flex min-h-0 flex-1 flex-col">
      <!-- 消息列表：select-text 放行文本选择，避免被根节点的 select-none 连带禁用 -->
      <div ref="messagesRef" class="editor-scroll relative flex flex-1 select-text flex-col gap-4 overflow-y-auto py-4" @scroll="handleScroll">
        <!-- 空状态：欢迎页 + 快捷提问 -->
        <div v-if="displayMessages.length === 0" class="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
          <!-- AI 图标：深色实心圆，作为整页视觉焦点 -->
          <span class="mb-4 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-accent text-inverse">
            <Icon icon="lucide:sparkles" :size="30" />
          </span>
          <p class="mb-1.5 text-[16px] font-semibold text-ink">开始对话</p>
          <p class="mb-5 max-w-[240px] text-[12px] leading-relaxed text-secondary">
            输入问题或点击下方快捷动作，AI 将基于当前文档内容提供帮助。
          </p>
          <!-- 快捷提问：单列卡片更舒展，点击直接发送，文档上下文由后端自动注入 -->
          <div class="flex w-full max-w-[260px] flex-col gap-2">
            <button
              v-for="action in quickActions"
              :key="action.label"
              type="button"
              class="group flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5 text-left text-[12px] text-secondary hover:bg-toolbar hover:text-ink"
              @click="handleQuickAction(action.prompt)"
            >
              <span class="shrink-0 text-muted group-hover:text-accent">
                <Icon :icon="action.icon" :size="14" />
              </span>
              <span>{{ action.label }}</span>
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <AiChatMessage
          v-for="msg in displayMessages"
          :key="msg.id"
          :message="msg"
          :is-streaming="isStreaming"
          @insert="insertMessageToCursor"
          @copy="copyMessage"
          @retry="retry"
        />

        <!-- AI 思考中指示器：未收到任何思考/正文内容前的等待提示 -->
        <div v-if="isStreaming && !streamingContent && !streamingReasoning" class="flex flex-col items-start px-3">
          <div class="flex items-center gap-2 rounded-2xl rounded-bl-md bg-toolbar px-3.5 py-2.5 text-[12px] text-muted">
            <Icon icon="lucide:loader-2" :size="13" class="animate-spin text-accent" />
            <span>正在思考…</span>
          </div>
        </div>

        <!-- 流式输出中的临时消息 -->
        <div v-if="isStreaming && (streamingContent || streamingReasoning)" class="flex flex-col items-start px-3">
          <div class="w-full rounded-2xl rounded-bl-md bg-toolbar px-3.5 py-2.5">
            <!-- AI 小标识 -->
            <div class="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted">
              <Icon icon="lucide:sparkles" :size="12" class="text-accent" />
              <span>AI</span>
            </div>
            <AiChatReasoning
              v-if="streamingReasoning"
              :content="streamingReasoning"
              :streaming="!streamingContent"
            />
            <AiMarkdown v-if="streamingContent" ref="aiMarkdownRef">
              <!-- 已完成段落：独立缓存节点，key 稳定复用，不重建、不打断选中/复制；尾段：渲染成样式的进行中内容 -->
              <div v-for="block in streamingBlocks" :key="block.id" class="ai-md-block" v-html="block.html" />
              <div v-if="streamingTail" class="ai-md-tail" v-html="streamingTail" />
            </AiMarkdown>
            <!-- 流式中右下角停止按钮 -->
            <div class="mt-2 flex justify-end">
              <button
                type="button"
                class="flex h-6 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted hover:bg-danger hover:text-inverse"
                title="停止"
                @mousedown.prevent="cancel"
              >
                <Icon icon="lucide:square" :size="10" />
                <span>停止</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 回到底部浮标：用户上翻历史时显示，点击回到底部 -->
        <button
          v-if="!isNearBottom"
          type="button"
          class="absolute right-4 bottom-4 z-10 flex h-7 cursor-pointer items-center gap-1 rounded-full border border-line bg-panel px-3 text-[11px] font-medium text-secondary hover:bg-toolbar hover:text-ink"
          @mousedown.prevent="jumpToBottom"
        >
          <Icon icon="lucide:arrow-down" :size="12" />
          <span>回到底部</span>
        </button>
      </div>

      <!-- 输入框 -->
      <AiChatInput
        ref="inputRef"
        :is-streaming="isStreaming"
        :pending-selections="props.pendingSelections"
        @send="sendMessage"
        @cancel="cancel"
        @remove-pending-selection="(i) => emit('remove-pending-selection', i)"
      >
        <!-- 模型选择器：仅影响 AI 对话，不改动全局设置 -->
        <template #footer-left>
          <AiModeSelector v-model="mode" :disabled="isStreaming || agentBusy" />
        </template>
        <template #footer-right>
          <AiChatModelSelector
            :current="selectedModel"
            :default-model="defaultModel"
            :models="modelList"
            :custom-models="customModelList"
            :loading="modelsLoading"
            :error="modelsError"
            :disabled="isStreaming"
            @select="handleModelSelect"
            @refresh="emit('open-settings')"

          />
        </template>
      </AiChatInput>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { normalizeAiMarkdown } from '../../utils/aiMarkdown'
import { useAiStatus } from '../../composables/useAiStatus'
import { useAiChat } from '../../composables/useAiChat'
import { useAiChatContext } from '../../composables/useAiChatContext'
import { modelCatalogRevision, readModelCatalog } from '../../services/aiModelCatalog'
import { aiService } from '../../services/aiService'
import type { AiModelInfo } from '../../types/ai'
import AiChatMessage from './AiChatMessage.vue'
import AiChatReasoning from './AiChatReasoning.vue'
import AiChatInput from './AiChatInput.vue'
import AiChatModelSelector from './AiChatModelSelector.vue'
import AiMarkdown from './AiMarkdown.vue'
import DocumentAgentPanel from './DocumentAgentPanel.vue'
import AiModeSelector from './AiModeSelector.vue'
import type { DocumentAgentOptions } from '../../composables/useDocumentAgent'

const props = defineProps<{
  documentOpen: boolean
  getDocumentContext: () => string
  getSelection: () => string
  getCursorOffset: () => number | null
  insertAtCursor: (text: string) => void
  replaceSelection: (text: string) => void
  getFilePath: () => string | null
  /** 文档标签 ID 能区分多个未保存文件。 */
  getDocumentId: () => number | null
  applyAgentDocument: (expected: string, next: string) => void
  pendingSelections?: string[]
}>()
import { overlayState } from '../../modules/overlayState'

const sidebarOpen = computed(() => overlayState.aiChatOpen.value && props.documentOpen)
const mode = ref<'chat' | 'agent'>('chat')
const agentBusy = ref(false)
// 函数在实际调用时获取最新编辑器状态，避免保存旧标签页引用。
const agentOptions: DocumentAgentOptions = {
  getDocument: () => props.getDocumentContext(),
  getDocumentId: () => props.getDocumentId(),
  getSelection: () => props.getSelection(),
  getModel: () => selectedModel.value || null,
  applyDocument: (expected, next) => props.applyAgentDocument(expected, next),
}

const emit = defineEmits<{
  close: []
  'open-settings': []
  'clear-pending-selections': []
  'remove-pending-selection': [index: number]
}>()

// AI 状态
const { status, isConfigured } = useAiStatus()
const aiReady = computed(() => isConfigured())

// ─── 模型选择（仅影响 AI 对话，不改动全局设置） ───────────────────────

// 按厂商记忆侧栏选择的模型，空字符串表示跟随设置页默认模型
const MODEL_OVERRIDE_STORAGE_KEY = 'ai-chat-model-override'

const readOverrideMap = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(MODEL_OVERRIDE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: Record<string, string> = {}
    for (const [provider, model] of Object.entries(parsed)) {
      if (typeof model === 'string') result[provider] = model
    }
    return result
  } catch {
    return {}
  }
}

const writeOverride = (provider: string, model: string): void => {
  if (!provider) return
  try {
    const map = readOverrideMap()
    map[provider] = model
    localStorage.setItem(MODEL_OVERRIDE_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // localStorage 写入失败时静默忽略
  }
}

const selectedModel = ref('')
const defaultModel = computed(() => status.value?.model ?? '')
const currentProvider = computed(() => status.value?.provider ?? '')

const modelList = ref<AiModelInfo[]>([])
const customModelList = ref<string[]>([])
const modelsLoading = ref(false)
const modelsError = ref('')
// 厂商切换时恢复该厂商的选择，保持原有模型覆盖规则。
watch(currentProvider, (provider) => {
  selectedModel.value = provider ? (readOverrideMap()[provider] ?? '') : ''
}, { immediate: true })

let catalogRequest = 0
// 只读取本地配置和设置页保存的列表，不向厂商获取模型。
const syncModelCatalog = async (): Promise<void> => {
  const request = ++catalogRequest
  modelsLoading.value = true
  modelsError.value = ''
  modelList.value = []
  customModelList.value = []
  try {
    const settings = await aiService.getSettings()
    if (request !== catalogRequest) return
    const config = settings.providers[settings.provider]
    modelList.value = readModelCatalog(settings.provider, config.baseUrl ?? '')
    customModelList.value = config.customModels ?? []
  } catch (error) {
    if (request === catalogRequest) modelsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (request === catalogRequest) modelsLoading.value = false
  }
}

// 首次加载和保存设置时提前同步，点击下拉框只展开已有列表。
watch([status, modelCatalogRevision], () => { void syncModelCatalog() }, { immediate: true })

const handleModelSelect = (id: string): void => {
  selectedModel.value = id
  writeOverride(currentProvider.value, id)
}

// 文档上下文
const { hasDocument, hasSelection, resolveReferences } = useAiChatContext({
  getDocumentContent: props.getDocumentContext,
  getSelection: props.getSelection,
  getCursorOffset: props.getCursorOffset,
})

// Chat 状态
const {
  messages,
  isStreaming,
  streamingContent,
  streamingReasoning,
  sendMessage: rawSendMessage,
  cancel,
  retry: rawRetry,
  clearHistory,
  insertMessageToCursor,
  copyMessage,
} = useAiChat({
  getDocumentContext: props.getDocumentContext,
  getSelection: props.getSelection,
  getCursorOffset: props.getCursorOffset,
  insertAtCursor: props.insertAtCursor,
  replaceSelection: props.replaceSelection,
  filePath: props.getFilePath,
  getModelOverride: () => selectedModel.value || null,
})

// 消息列表引用
const messagesRef = ref<HTMLElement | null>(null)
const inputRef = ref<InstanceType<typeof AiChatInput> | null>(null)
const agentPanelRef = ref<InstanceType<typeof DocumentAgentPanel> | null>(null)

// 显示的消息（排除流式中的临时内容）
const displayMessages = computed(() => messages.value)

// 流式内容按段落 / 代码块分段增量渲染，避免每个 delta 全量重解析 + 整体 v-html 替换（O(n²)）。
// 已完成块缓存为独立 DOM 节点（key 稳定复用，不重建，保住选中 / 复制状态）；
// 正在写的最后一段降级为纯文本，未闭合的代码围栏按原文展示，直到闭合才升级为 markdown 块。
interface StreamBlock {
  id: number
  html: string
}

// 按空行与代码围栏边界切分流式文本，返回 [已完成块..., 尾块]。
// 尾块可能是一段未写完的正文，也可能是未闭合的 ``` 围栏。
const splitStreamBlocks = (text: string): { done: string[]; tail: string } => {
  const done: string[] = []
  let current = ''
  let inFence = false
  for (const line of text.split('\n')) {
    const isFence = /^\s*```/.test(line)
    if (isFence) {
      if (!inFence) {
        if (current) {
          done.push(current)
          current = ''
        }
        current = line
        inFence = true
      } else {
        current += '\n' + line
        done.push(current)
        current = ''
        inFence = false
      }
    } else if (!inFence && line.trim() === '') {
      if (current) {
        done.push(current)
        current = ''
      }
    } else {
      current += (current ? '\n' : '') + line
    }
  }
  return { done, tail: current }
}

const streamingBlocks = ref<StreamBlock[]>([])
const streamingTail = ref('')
let nextBlockId = 0

// 流式分块的 HTML 由共享渲染器组件预渲染；flush: 'post' 确保组件随 streamingContent 挂载后 ref 可用
const aiMarkdownRef = ref<InstanceType<typeof AiMarkdown> | null>(null)

watch(
  streamingContent,
  (text) => {
    if (!text) {
      streamingBlocks.value = []
      streamingTail.value = ''
      nextBlockId = 0
      return
    }
    const { done, tail } = splitStreamBlocks(normalizeAiMarkdown(text))
    // 已完成块只增量补齐：新增块渲染一次，旧块 HTML 与 DOM 节点保持不变
    for (let i = streamingBlocks.value.length; i < done.length; i++) {
      streamingBlocks.value.push({
        id: nextBlockId++,
        html: aiMarkdownRef.value?.render(done[i]) ?? '',
      })
    }
    // 尾段也实时渲染成样式（renderTail 对未闭合代码围栏单独降级为等宽代码块），
    // 让正在写入的段落即时显示排版效果，而非以原始 md 标记等待写完后才转换。
    streamingTail.value = aiMarkdownRef.value?.renderTail(tail) ?? ''
  },
  { flush: 'post' },
)

// 状态文本：仅展示流式生成状态，其余保持默认（不显示消息数量）
const statusText = computed(() => {
  if (isStreaming.value) return streamingContent.value || !streamingReasoning.value ? '正在生成…' : '正在思考…'
  return ''
})

// 发送消息（处理 @引用）
const sendMessage = async (content: string): Promise<void> => {
  const resolved = resolveReferences(content)
  // 发送前复制引用，生成期间新增的选区不属于本轮请求。
  const references = [...(props.pendingSelections ?? [])]
  // 发送后立即清空输入框，让用户能立刻输入下一条问题，不必等到 AI 回复完。
  // 选区由附件或显式 @选区 提供；移除附件后不再暗中读取编辑器选区。
  inputRef.value?.clearDraft(content)
  const succeeded = await rawSendMessage(resolved.message, {
    documentContext: resolved.documentContext,
    selection: resolved.selection,
    ...(resolved.cursorOffset !== null ? { cursorOffset: resolved.cursorOffset } : {}),
  }, references)
  if (!succeeded) {
    // 发送失败（网络/模型报错）：把清空掉的草稿放回输入框，避免内容丢失。
    inputRef.value?.restoreDraft(content)
    return
  }
  clearSentReferences(references)
}

// 成功发送后，移除本轮已发送的引用标签；从后往前移除，避免索引错位。
const clearSentReferences = (references: string[]): void => {
  for (let index = references.length - 1; index >= 0; index--) {
    if (props.pendingSelections?.[index] === references[index]) emit('remove-pending-selection', index)
  }
}

// 重新生成沿用历史引用，输入区后来添加的引用不参与本次重试。
const retry = async (): Promise<void> => {
  const message = [...messages.value].reverse().find((item) => item.role === 'user')
  if (!message) return
  // 重试成功后，若该条草稿仍留在输入框（如上次失败被恢复回来）则一并清空；不清除引用。
  if (await rawRetry()) inputRef.value?.clearDraft(message.content)
}

// 空状态快捷提问：提示词均围绕当前文档，点击即发送
const quickActions = [
  { icon: 'lucide:file-text', label: '总结这篇文档', prompt: '请用简洁的几句话总结这篇文档的核心内容。' },
  { icon: 'lucide:list-tree', label: '生成大纲', prompt: '请为这篇文档生成一份层级结构大纲。' },
  { icon: 'lucide:spell-check', label: '校对错别字', prompt: '请检查这篇文档中的错别字和语句不通顺的地方，逐条列出。' },
  { icon: 'lucide:lightbulb', label: '改进建议', prompt: '请指出这篇文档在结构或内容上可以改进的地方。' },
]

const handleQuickAction = (prompt: string): void => {
  sendMessage(prompt)
}

// 根据当前模式清除对应记录；Agent 已写入编辑器的修改不会被回滚。
const handleClear = (): void => {
  if (mode.value === 'agent') {
    agentPanelRef.value?.clear()
    return
  }
  clearHistory()
}

// ─── 自动滚动：仅当贴近底部时才跟随到底，用户上翻历史时不被强制拽回 ───

/** 距底部多少像素内视为「贴近底部」，此范围内新内容才自动滚动跟随 */
const NEAR_BOTTOM_THRESHOLD = 80

// 是否贴近底部；用户上翻时会随 scroll 事件置为 false，浮标随之出现
const isNearBottom = ref(true)

const handleScroll = (): void => {
  const el = messagesRef.value
  if (el) {
    isNearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD
  }
}

// 滚动到底部（内容变化自动跟随、浮标点击共用）
const scrollToBottom = (): void => {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
      isNearBottom.value = true
    }
  })
}

// 浮标点击
const jumpToBottom = (): void => {
  scrollToBottom()
}

watch(
  () => [messages.value.length, streamingContent.value, streamingReasoning.value],
  () => {
    if (isNearBottom.value) scrollToBottom()
  },
)

onMounted(() => {
  scrollToBottom()
})

// 侧栏常驻挂载，只有真正显示时才聚焦输入框，避免启动阶段抢走编辑器焦点。
watch(
  sidebarOpen,
  (open) => {
    if (open) nextTick(() => inputRef.value?.focus())
  },
)

// ─── 拖拽调整宽度 ───────────────────────────────────────────────────

const sidebarWidth = ref(400)
const isResizing = ref(false)
let startX = 0
let startWidth = 0

const startResize = (event: MouseEvent): void => {
  isResizing.value = true
  startX = event.clientX
  startWidth = sidebarWidth.value

  const onMouseMove = (e: MouseEvent): void => {
    const delta = startX - e.clientX
    sidebarWidth.value = Math.min(560, Math.max(320, startWidth + delta))
  }

  const onMouseUp = (): void => {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}
</script>
