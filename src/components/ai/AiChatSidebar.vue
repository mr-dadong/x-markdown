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
          <h2 class="text-[13px] font-semibold leading-tight text-ink">AI Chat</h2>
          <span class="text-[11px] leading-tight text-muted">{{ statusText }}</span>
        </div>
      </div>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-toolbar hover:text-ink"
          title="清空对话"
          @mousedown.prevent="handleClear"
        >
          <Icon icon="lucide:trash-2" :size="14" />
        </button>
        <button
          type="button"
          class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-toolbar hover:text-ink"
          title="关闭"
          @mousedown.prevent="emit('close')"
        >
          <Icon icon="lucide:x" :size="16" />
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
            <div v-if="streamingContent" class="ai-md markdown-body">
              <!-- 已完成段落：独立缓存节点，key 稳定复用，不重建、不打断选中/复制；尾段：纯文本降级渲染 -->
              <div v-for="block in streamingBlocks" :key="block.id" class="ai-md-block" v-html="block.html" />
              <div v-if="streamingTail" class="ai-md-tail">{{ streamingTail }}</div>
            </div>
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
        @clear-pending-selections="emit('clear-pending-selections')"
        @remove-pending-selection="(i) => emit('remove-pending-selection', i)"
      >
        <!-- 模型选择器：仅影响 AI 对话，不改动全局设置 -->
        <template #footer-left>
          <AiChatModelSelector
            :current="selectedModel"
            :default-model="defaultModel"
            :models="modelList"
            :custom-models="customModelList"
            :loading="modelsLoading"
            :error="modelsError"
            :disabled="isStreaming"
            @select="handleModelSelect"
            @refresh="fetchModelList"
            @open="handleModelDropdownOpen"
          />
        </template>
      </AiChatInput>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import MarkdownIt from 'markdown-it'
import { normalizeAiMarkdown } from '../../utils/aiMarkdown'
import { useAiStatus } from '../../composables/useAiStatus'
import { useAiChat } from '../../composables/useAiChat'
import { useAiChatContext } from '../../composables/useAiChatContext'
import { aiService } from '../../services/aiService'
import type { AiModelInfo } from '../../types/ai'
import AiChatMessage from './AiChatMessage.vue'
import AiChatReasoning from './AiChatReasoning.vue'
import AiChatInput from './AiChatInput.vue'
import AiChatModelSelector from './AiChatModelSelector.vue'

const props = defineProps<{
  documentOpen: boolean
  getDocumentContext: () => string
  getSelection: () => string
  getCursorOffset: () => number | null
  insertAtCursor: (text: string) => void
  replaceSelection: (text: string) => void
  getFilePath: () => string | null
  pendingSelections?: string[]
}>()
import { overlayState } from '../../modules/overlayState'

const sidebarOpen = computed(() => overlayState.aiChatOpen.value && props.documentOpen)

const emit = defineEmits<{
  close: []
  'open-settings': []
  'clear-pending-selections': []
  'remove-pending-selection': [index: number]
}>()

// 初始化 markdown-it
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: true,
})

// 自定义代码块渲染
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const lang = token.info.trim()
  const langLabel = lang ? `<span class="code-lang">${lang}</span>` : ''
  const content = md.utils.escapeHtml(token.content)
  return `<div class="code-block-wrapper">${langLabel}<pre class="code-block"><code>${content}</code></pre></div>`
}

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
// 按厂商缓存已拉取的模型列表，避免每次展开下拉都请求厂商接口
const modelsCache = new Map<string, AiModelInfo[]>()

// 厂商变化（含首次状态加载完成）时，恢复该厂商记住的选择并重置列表
watch(
  currentProvider,
  (provider) => {
    selectedModel.value = provider ? (readOverrideMap()[provider] ?? '') : ''
    modelList.value = modelsCache.get(provider) ?? []
    customModelList.value = []
    modelsError.value = ''
  },
  { immediate: true },
)

const fetchModelList = async (): Promise<void> => {
  const provider = currentProvider.value
  if (!provider || modelsLoading.value) return
  modelsLoading.value = true
  modelsError.value = ''
  try {
    // 模型列表按已保存的设置拉取，与 chat agent 使用的配置保持一致
    const [modelsResult, settings] = await Promise.all([aiService.fetchModels(), aiService.getSettings()])
    modelsCache.set(provider, modelsResult.models)
    modelList.value = modelsResult.models
    customModelList.value = settings.providers[provider]?.customModels ?? []
    modelsError.value = modelsResult.error ?? ''
  } catch (fetchError) {
    modelsError.value = fetchError instanceof Error ? fetchError.message : String(fetchError)
  } finally {
    modelsLoading.value = false
  }
}

// 首次展开时懒加载模型列表；已有缓存时仅同步该厂商的自定义模型
const handleModelDropdownOpen = (): void => {
  const provider = currentProvider.value
  if (!provider || modelsLoading.value) return
  if (modelsCache.has(provider)) {
    void aiService
      .getSettings()
      .then((settings) => {
        if (currentProvider.value === provider) {
          customModelList.value = settings.providers[provider]?.customModels ?? []
        }
      })
      .catch(() => {})
    return
  }
  void fetchModelList()
}

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
  retry,
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

watch(streamingContent, (text) => {
  if (!text) {
    streamingBlocks.value = []
    streamingTail.value = ''
    nextBlockId = 0
    return
  }
  const { done, tail } = splitStreamBlocks(normalizeAiMarkdown(text))
  // 已完成块只增量补齐：新增块渲染一次，旧块 HTML 与 DOM 节点保持不变
  for (let i = streamingBlocks.value.length; i < done.length; i++) {
    streamingBlocks.value.push({ id: nextBlockId++, html: md.render(done[i]) })
  }
  // 尾块用 textContent 展示，未闭合代码块 / 写到一半的标记以原文出现，不炸渲染
  streamingTail.value = tail
})

// 状态文本
const statusText = computed(() => {
  if (isStreaming.value) return streamingContent.value || !streamingReasoning.value ? '正在生成…' : '正在思考…'
  if (displayMessages.value.length === 0) return ''
  return `${displayMessages.value.filter((m) => m.role !== 'system').length} 条消息`
})

// 发送消息（处理 @引用）
const sendMessage = (content: string): void => {
  const resolved = resolveReferences(content)
  // 文档上下文始终显式传递（可能为空字符串，表示仅 @选区 时刻意不带文档）；
  // 选区仅在用户显式 @选区 时传递，否则回退到 useAiChat 内部取当前选区的默认行为
  void rawSendMessage(resolved.message, {
    documentContext: resolved.documentContext,
    ...(resolved.selection ? { selection: resolved.selection } : {}),
    ...(resolved.cursorOffset !== null ? { cursorOffset: resolved.cursorOffset } : {}),
  })
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

// 清空对话
const handleClear = (): void => {
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

<style scoped>
/* 流式临时消息里的 Markdown 正文排版（内容由 v-html 渲染，只能用深度选择器控制样式） */
.ai-md {
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-ink);
}

/* 流式分段渲染：块之间的间距由包裹层控制，最后一个块贴底不残留空隙 */
.ai-md :deep(.ai-md-block) {
  margin-bottom: 8px;
}

.ai-md :deep(.ai-md-block:last-child) {
  margin-bottom: 0;
}

/* 尾段：纯文本降级，保留换行与缩进，长串自动换行 */
.ai-md :deep(.ai-md-tail) {
  white-space: pre-wrap;
  word-break: break-word;
}

/* 标题 */
.ai-md :deep(h1),
.ai-md :deep(h2),
.ai-md :deep(h3),
.ai-md :deep(h4) {
  margin-top: 14px;
  margin-bottom: 6px;
  font-weight: 600;
  line-height: 1.4;
}

.ai-md :deep(h1) { font-size: 18px; }
.ai-md :deep(h2) { font-size: 16px; }
.ai-md :deep(h3) { font-size: 14px; }

.ai-md :deep(h1:first-child),
.ai-md :deep(h2:first-child),
.ai-md :deep(h3:first-child) {
  margin-top: 0;
}

/* 段落 */
.ai-md :deep(p) {
  margin: 0 0 8px;
}

.ai-md :deep(p:last-child) {
  margin-bottom: 0;
}

/* 列表 */
.ai-md :deep(ul),
.ai-md :deep(ol) {
  margin: 6px 0;
  padding-left: 22px;
}

.ai-md :deep(li) {
  margin: 3px 0;
}

/* 代码块 */
.ai-md :deep(.code-block-wrapper) {
  position: relative;
  margin: 8px 0;
}

.ai-md :deep(.code-lang) {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 10px;
  color: var(--color-muted);
  text-transform: uppercase;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  z-index: 1;
}

.ai-md :deep(.code-block) {
  background: var(--color-paper);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.ai-md :deep(code) {
  background: var(--color-selected);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
}

.ai-md :deep(pre code) {
  background: transparent;
  padding: 0;
}

/* 引用块 */
.ai-md :deep(blockquote) {
  margin: 8px 0;
  padding: 6px 10px;
  border-left: 3px solid var(--color-accent);
  background: var(--color-selected);
  border-radius: 0 6px 6px 0;
}

.ai-md :deep(blockquote p) {
  margin: 0;
}

/* 链接 */
.ai-md :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* 表格 */
.ai-md :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
  font-size: 12px;
}

.ai-md :deep(th),
.ai-md :deep(td) {
  border: 1px solid var(--color-line);
  padding: 5px 8px;
  text-align: left;
}

.ai-md :deep(th) {
  background: var(--color-selected);
  font-weight: 600;
}

/* 分割线 */
.ai-md :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-line);
  margin: 12px 0;
}

/* 强调 */
.ai-md :deep(strong) {
  font-weight: 600;
}
</style>
