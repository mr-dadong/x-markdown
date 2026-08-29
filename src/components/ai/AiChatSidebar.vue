<template>
  <aside v-show="sidebarOpen" class="chat-sidebar" :class="{ 'chat-sidebar--resizing': isResizing }">
    <!-- 拖拽调整宽度 -->
    <div class="chat-sidebar__resize-handle" @mousedown="startResize" />

    <!-- 头部 -->
    <header class="chat-sidebar__header">
      <div class="chat-sidebar__title">
        <span class="chat-sidebar__icon">
          <Icon icon="lucide:sparkles" :size="15" />
        </span>
        <div class="chat-sidebar__title-text">
          <h2>AI Chat</h2>
          <span class="chat-sidebar__subtitle">{{ statusText }}</span>
        </div>
      </div>
      <div class="chat-sidebar__header-actions">
        <button type="button" class="chat-sidebar__header-btn" title="清空对话" @mousedown.prevent="handleClear">
          <Icon icon="lucide:trash-2" :size="14" />
        </button>
        <button type="button" class="chat-sidebar__header-btn" title="关闭" @mousedown.prevent="emit('close')">
          <Icon icon="lucide:x" :size="16" />
        </button>
      </div>
    </header>

    <!-- AI 未配置 -->
    <div v-if="!aiReady" class="chat-sidebar__empty">
      <span class="chat-sidebar__empty-icon">
        <Icon icon="lucide:sparkles" :size="28" />
      </span>
      <p class="chat-sidebar__empty-title">尚未配置 AI</p>
      <p class="chat-sidebar__empty-desc">需要先设置模型提供方和 API Key，才能使用 AI Chat。</p>
      <button type="button" class="chat-sidebar__setup-btn" @mousedown.prevent="emit('open-settings')">
        <Icon icon="lucide:settings" :size="15" />
        <span>前往设置</span>
      </button>
    </div>

    <!-- 对话区域 -->
    <template v-else>
      <!-- 消息列表 -->
      <div ref="messagesRef" class="chat-sidebar__messages">
        <!-- 空状态 -->
        <div v-if="displayMessages.length === 0" class="chat-sidebar__welcome">
          <span class="chat-sidebar__welcome-icon">
            <Icon icon="lucide:sparkles" :size="32" />
          </span>
          <p class="chat-sidebar__welcome-title">开始对话</p>
          <p class="chat-sidebar__welcome-desc">
            输入问题或使用快捷动作，AI 将基于当前文档内容提供帮助。
          </p>
          <div class="chat-sidebar__welcome-hints">
            <div class="chat-sidebar__hint">
              <Icon icon="lucide:file-text" :size="12" />
              <span>AI 会基于当前文档内容回答</span>
            </div>
            <div class="chat-sidebar__hint">
              <Icon icon="lucide:corner-down-left" :size="12" />
              <span>Enter 发送，Shift+Enter 换行</span>
            </div>
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

        <!-- AI 思考中指示器 -->
        <div v-if="isStreaming && !streamingContent" class="chat-thinking">
          <div class="chat-thinking__bubble">
            <span class="chat-thinking__dot" />
            <span class="chat-thinking__dot" />
            <span class="chat-thinking__dot" />
          </div>
        </div>

        <!-- 流式输出中的临时消息 -->
        <div v-if="isStreaming && streamingContent" class="chat-msg chat-msg--assistant" style="padding: 0 12px;">
          <div class="chat-msg__bubble chat-msg__bubble--assistant">
            <div class="chat-msg__header">
              <span class="chat-msg__badge">
                <Icon icon="lucide:sparkles" :size="11" />
                <span>AI</span>
              </span>
            </div>
            <div class="chat-msg__content markdown-body" v-html="renderedStreamingContent" />
            <div class="chat-sidebar__streaming-indicator">
              <span class="chat-sidebar__typing-cursor" />
              <button type="button" class="chat-sidebar__stop-btn" title="停止" @mousedown.prevent="cancel">
                <Icon icon="lucide:square" :size="10" />
                <span>停止</span>
              </button>
            </div>
          </div>
        </div>
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
      />
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import MarkdownIt from 'markdown-it'
import { useAiStatus } from '../../composables/useAiStatus'
import { useAiChat } from '../../composables/useAiChat'
import { useAiChatContext } from '../../composables/useAiChatContext'
import AiChatMessage from './AiChatMessage.vue'
import AiChatInput from './AiChatInput.vue'

const props = defineProps<{
  documentOpen: boolean
  getDocumentContext: () => string
  getSelection: () => string
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
const { isConfigured } = useAiStatus()
const aiReady = computed(() => isConfigured())

// 文档上下文
const { hasDocument, hasSelection, resolveReferences } = useAiChatContext({
  getDocumentContent: props.getDocumentContext,
  getSelection: props.getSelection,
})

// Chat 状态
const {
  messages,
  isStreaming,
  streamingContent,
  sendMessage: rawSendMessage,
  cancel,
  retry,
  clearHistory,
  insertMessageToCursor,
  copyMessage,
} = useAiChat({
  getDocumentContext: props.getDocumentContext,
  getSelection: props.getSelection,
  insertAtCursor: props.insertAtCursor,
  replaceSelection: props.replaceSelection,
  filePath: props.getFilePath,
})

// 消息列表引用
const messagesRef = ref<HTMLElement | null>(null)
const inputRef = ref<InstanceType<typeof AiChatInput> | null>(null)

// 显示的消息（排除流式中的临时内容）
const displayMessages = computed(() => messages.value)

// 流式内容的 Markdown 渲染
const renderedStreamingContent = computed(() => {
  if (!streamingContent.value) return ''
  return md.render(streamingContent.value)
})

// 状态文本
const statusText = computed(() => {
  if (isStreaming.value) return '正在生成…'
  if (displayMessages.value.length === 0) return ''
  return `${displayMessages.value.filter((m) => m.role !== 'system').length} 条消息`
})

// 发送消息（处理 @引用）
const sendMessage = (content: string): void => {
  const resolved = resolveReferences(content)
  void rawSendMessage(resolved.message)
}

// 清空对话
const handleClear = (): void => {
  clearHistory()
}

// 自动滚动到底部
const scrollToBottom = (): void => {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

watch(
  () => [messages.value.length, streamingContent.value],
  () => scrollToBottom(),
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
.chat-sidebar {
  display: flex;
  flex-direction: column;
  width: v-bind(sidebarWidth + 'px');
  min-width: 320px;
  max-width: 560px;
  height: 100%;
  flex-shrink: 0;
  background: var(--color-paper);
  border-left: 1px solid var(--color-line);
  position: relative;
  user-select: none;
}

.chat-sidebar--resizing {
  user-select: none;
  pointer-events: none;
}

.chat-sidebar__resize-handle {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 10;
}

.chat-sidebar__resize-handle:hover {
  background: var(--color-accent);
  opacity: 0.3;
}

/* 头部 */
.chat-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-line);
  flex-shrink: 0;
}

.chat-sidebar__title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.chat-sidebar__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--color-selected);
  color: var(--color-accent);
  flex-shrink: 0;
}

.chat-sidebar__title-text {
  min-width: 0;
}

.chat-sidebar__title-text h2 {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-ink);
  margin: 0;
  line-height: 1.2;
}

.chat-sidebar__subtitle {
  font-size: 10px;
  color: var(--color-muted);
}

.chat-sidebar__header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.chat-sidebar__header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.chat-sidebar__header-btn:hover {
  background: var(--color-toolbar);
  color: var(--color-ink);
}

/* 空状态 */
.chat-sidebar__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 24px;
  text-align: center;
}

.chat-sidebar__empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--color-selected);
  color: var(--color-muted);
  margin-bottom: 16px;
}

.chat-sidebar__empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
  margin: 0 0 6px;
}

.chat-sidebar__empty-desc {
  font-size: 12px;
  color: var(--color-secondary);
  line-height: 1.5;
  margin: 0 0 16px;
}

.chat-sidebar__setup-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  border: none;
  background: var(--color-accent);
  color: var(--color-inverse);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.chat-sidebar__setup-btn:hover {
  background: var(--color-accent-strong);
}

/* 消息列表 */
.chat-sidebar__messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 欢迎页 */
.chat-sidebar__welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 32px 24px;
  text-align: center;
}

.chat-sidebar__welcome-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: var(--color-selected);
  color: var(--color-accent);
  margin-bottom: 16px;
}

.chat-sidebar__welcome-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
  margin: 0 0 6px;
}

.chat-sidebar__welcome-desc {
  font-size: 12px;
  color: var(--color-secondary);
  line-height: 1.5;
  margin: 0 0 20px;
  max-width: 260px;
}

.chat-sidebar__welcome-hints {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 220px;
}

.chat-sidebar__hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--color-muted);
  text-align: left;
}

.chat-sidebar__hint :deep(svg) {
  flex-shrink: 0;
  opacity: 0.6;
}

/* 流式输出 */
.chat-sidebar__streaming-indicator {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-line);
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-sidebar__typing-cursor {
  display: inline-block;
  width: 2px;
  height: 14px;
  background: var(--color-accent);
  animation: blink 1s infinite;
  border-radius: 1px;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.chat-sidebar__stop-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.chat-sidebar__stop-btn:hover {
  background: #dc2626;
  color: #ffffff;
}

/* AI 思考中动画 */
.chat-thinking {
  padding: 0 12px;
  display: flex;
  align-items: flex-start;
}

.chat-thinking__bubble {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 14px;
  background: var(--color-panel);
  border: 1px solid var(--color-line);
  border-radius: 10px 10px 10px 2px;
}

.chat-thinking__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-muted);
  animation: thinking 1.4s infinite;
}

.chat-thinking__dot:nth-child(2) {
  animation-delay: 0.2s;
}

.chat-thinking__dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes thinking {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

/* 消息入场动画 */
.chat-msg {
  animation: msgSlideIn 0.2s ease-out;
}

@keyframes msgSlideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 复用消息样式 */
.chat-msg {
  display: flex;
  flex-direction: column;
}

.chat-msg--assistant {
  align-items: flex-start;
}

.chat-msg__bubble {
  max-width: 100%;
  border-radius: 10px;
  word-break: break-word;
}

.chat-msg__bubble--assistant {
  background: var(--color-panel);
  border: 1px solid var(--color-line);
  padding: 10px 12px;
  border-radius: 10px 10px 10px 2px;
  width: 100%;
}

.chat-msg__header {
  margin-bottom: 6px;
}

.chat-msg__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-accent);
  padding: 2px 6px;
  background: var(--color-selected);
  border-radius: 4px;
}

.chat-msg__content {
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-ink);
}

/* Markdown 渲染样式 */
.chat-msg__content :deep(h1),
.chat-msg__content :deep(h2),
.chat-msg__content :deep(h3),
.chat-msg__content :deep(h4) {
  margin-top: 14px;
  margin-bottom: 6px;
  font-weight: 600;
  line-height: 1.4;
}

.chat-msg__content :deep(h1) { font-size: 18px; }
.chat-msg__content :deep(h2) { font-size: 16px; }
.chat-msg__content :deep(h3) { font-size: 14px; }

.chat-msg__content :deep(h1:first-child),
.chat-msg__content :deep(h2:first-child),
.chat-msg__content :deep(h3:first-child) {
  margin-top: 0;
}

.chat-msg__content :deep(p) {
  margin: 0 0 8px;
}

.chat-msg__content :deep(p:last-child) {
  margin-bottom: 0;
}

.chat-msg__content :deep(ul),
.chat-msg__content :deep(ol) {
  margin: 6px 0;
  padding-left: 22px;
}

.chat-msg__content :deep(li) {
  margin: 3px 0;
}

.chat-msg__content :deep(.code-block-wrapper) {
  position: relative;
  margin: 8px 0;
}

.chat-msg__content :deep(.code-lang) {
  position: absolute;
  top: 6px;
  right: 10px;
  font-size: 10px;
  color: var(--color-muted);
  text-transform: uppercase;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  z-index: 1;
}

.chat-msg__content :deep(.code-block) {
  background: var(--color-paper);
  border: 1px solid var(--color-line);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 1.6;
}

.chat-msg__content :deep(code) {
  background: var(--color-selected);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
}

.chat-msg__content :deep(pre code) {
  background: transparent;
  padding: 0;
}

.chat-msg__content :deep(blockquote) {
  margin: 8px 0;
  padding: 6px 10px;
  border-left: 3px solid var(--color-accent);
  background: var(--color-selected);
  border-radius: 0 6px 6px 0;
}

.chat-msg__content :deep(blockquote p) {
  margin: 0;
}

.chat-msg__content :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.chat-msg__content :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
  font-size: 12px;
}

.chat-msg__content :deep(th),
.chat-msg__content :deep(td) {
  border: 1px solid var(--color-line);
  padding: 5px 8px;
  text-align: left;
}

.chat-msg__content :deep(th) {
  background: var(--color-selected);
  font-weight: 600;
}

.chat-msg__content :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-line);
  margin: 12px 0;
}

.chat-msg__content :deep(strong) {
  font-weight: 600;
}
</style>
