<template>
  <!-- 填满主区域，不再按文档内容的固有宽度占位。 -->
  <div ref="editorShell" class="relative flex h-full min-w-0 flex-1 overflow-hidden bg-paper" @mousemove="handleEditorMouseMove"
    @mouseover="handleLinkMouseOver" @click="handleEditorContentClick" @keydown="handleAttachmentKeydown" @mouseleave="handleEditorAreaLeave"
    @dragover.capture="handleBlockDragOver" @drop.capture="handleBlockDrop">
    <!-- 编辑器内容区域：typography-pane 承载排版与预览缩放样式，通过 CSS 变量生效。 -->
    <editor-content :editor="editor" class="editor-scroll typography-pane h-full min-w-0 flex-1 overflow-y-auto"
      :style="typographyStyle" @scroll="refreshBlockControlPosition" />

    <!-- 只在光标位于表格内时出现，常用结构操作无需再记快捷键。 -->
    <bubble-menu v-if="editor" :editor="editor" :should-show="shouldShowTableMenu"
      :tippy-options="{ placement: 'top', maxWidth: 720 }">
      <div class="flex items-center gap-0.5 rounded-md bg-ink p-1 text-inverse" contenteditable="false">
        <template v-for="(action, index) in tableActions" :key="action.title">
          <!-- 使用 currentColor 继承工具栏前景色，避免 CSS 变量叠加透明度后颜色失效。 -->
          <span v-if="tableActionSeparators.includes(index)" class="mx-1 h-5 w-px bg-current opacity-30" />
          <button type="button" :title="action.title"
            class="flex h-8 w-8 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-1 focus-visible:outline-inverse disabled:cursor-not-allowed disabled:opacity-30"
            :class="action.danger ? 'text-danger hover:bg-danger hover:text-white' : 'hover:bg-white/10 hover:text-white'" :disabled="!action.canRun()"
            @mousedown.prevent="action.run()">
            <span class="flex h-5 items-center justify-center gap-0.5">
              <Icon :icon="typeof action.icon === 'function' ? action.icon() : action.icon" :size="17" />
            </span>
          </button>
        </template>
      </div>
    </bubble-menu>

    <!-- 左侧轨道仅保留操作热区，不使用边框和底色，避免拖拽柄抢夺正文注意力。 -->
    <div v-if="blockControlVisible && activeBlock" data-block-control class="fixed z-20 flex h-7 items-center text-muted/45"
      :style="blockControlStyle" contenteditable="false" @mousemove.stop @mouseleave="handleBlockControlLeave">
      <button type="button" draggable="true" title="拖动内容块"
        class="flex h-7 w-6 cursor-grab items-center justify-center rounded hover:bg-control-hover hover:text-secondary active:cursor-grabbing focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @click.stop="toggleBlockMenu" @dragstart="handleBlockDragStart" @dragend="finishBlockDrag">
        <Icon icon="lucide:grip-vertical" :size="14" />
      </button>
      <!-- 折叠箭头靠近标题，拖拽柄留在外侧，操作层级更符合阅读方向。 -->
      <button v-if="activeBlock.isHeading" type="button"
        class="flex h-7 w-7 items-center justify-center rounded text-muted/70 hover:bg-control-hover hover:text-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        :title="activeBlockCollapsed ? '展开章节' : '折叠章节'" @click="toggleActiveHeading">
        <Icon :icon="activeBlockCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'" :size="14" />
      </button>
    </div>

    <!-- 飞书式块菜单：拖拽柄既可移动，单击也能完成常用的块级管理。 -->
    <div v-if="blockMenuVisible && activeBlock" ref="blockMenu" data-block-menu
      class="fixed z-40 flex w-32 flex-col rounded-lg border border-line bg-toolbar p-1 text-[11px] text-secondary"
      :style="safeBlockMenuStyle" contenteditable="false" @mousedown.stop>
      <template v-for="action in blockActions" :key="action.label">
        <span v-if="action.divideBefore" class="mx-1 my-0.5 h-px shrink-0 bg-line" />
        <button type="button"
          class="flex h-7 items-center gap-1.5 rounded-md px-2 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:text-muted/40 disabled:hover:bg-transparent"
          :class="action.danger
            ? 'text-danger hover:bg-danger/10 hover:text-danger'
            : 'hover:bg-control hover:text-ink'"
          :disabled="action.disabled?.()"
          @mousedown.prevent="action.run()">
          <Icon :icon="action.icon" :size="13" class="shrink-0 text-muted" :class="action.danger ? 'text-danger' : ''" />
          <span class="flex-1">{{ action.label }}</span>
        </button>
      </template>
    </div>

    <div v-if="dropIndicator" class="pointer-events-none fixed z-30 h-0.5 bg-accent" :style="dropIndicatorStyle" />

    <!-- 斜杠命令的链接表单保留原选区，不再依赖会打断编辑器焦点的系统弹窗。 -->
    <InsertLinkPanel
      v-if="linkInsertVisible"
      v-model:url="linkInsertUrl"
      v-model:label="linkInsertLabel"
      :error="linkInsertError"
      :position="linkInsertStyle"
      @cancel="cancelLinkInsert"
      @submit="submitLinkInsert"
    />

    <!-- 链接操作层贴近正文出现，阅读时保持安静，指向链接后可直接打开、编辑或复制。 -->
    <div v-if="activeLink" data-link-menu class="fixed z-40 flex flex-col rounded-lg border border-line bg-paper p-1"
      :style="linkMenuStyle" contenteditable="false" @mouseenter="cancelLinkMenuClose"
      @mouseleave="scheduleLinkMenuClose">
      <div v-if="editingLink" class="flex w-[360px] items-center gap-1 p-1">
        <input ref="linkInput" v-model="linkDraft" type="url" placeholder="粘贴或输入链接"
          class="h-8 min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 text-[13px] text-ink outline-none focus:border-link"
          @keydown.enter.prevent="saveLink" @keydown.esc.prevent="cancelEditLink">
        <button type="button" title="保存链接"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-link"
          @mousedown.prevent="saveLink">
          <Icon icon="lucide:check" :size="16" />
        </button>
      </div>
      <div v-else class="flex max-w-[440px] items-center gap-1">
        <button type="button" title="打开链接"
          class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-control-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-link"
          @mousedown.prevent="openActiveLink">
          <Icon icon="lucide:link-2" :size="15" class="shrink-0 text-link" />
          <span class="max-w-[260px] truncate text-[12px] text-secondary">{{ activeLink.href }}</span>
          <Icon icon="lucide:external-link" :size="13" class="shrink-0 text-muted" />
        </button>
        <span class="h-5 w-px bg-line" />
        <button type="button" title="编辑链接"
          class="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-link"
          @mousedown.prevent="startEditLink">
          <Icon icon="lucide:pen-line" :size="15" />
        </button>
        <button type="button" title="复制链接"
          class="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-link"
          @mousedown.prevent="copyActiveLink">
          <Icon :icon="linkCopied ? 'lucide:check' : 'lucide:copy'" :size="15" />
        </button>
        <button type="button" title="取消链接"
          class="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-danger focus-visible:outline focus-visible:outline-1 focus-visible:outline-link"
          @mousedown.prevent="removeActiveLink">
          <Icon icon="lucide:unlink" :size="15" />
        </button>
      </div>
    </div>

    <!-- 斜杠命令面板：跟随光标浮动。 -->
    <div v-if="slashMenuVisible" ref="slashMenu"
      class="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-line/60 bg-paper shadow-[0_8px_30px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
      :class="settings.showSlashCommandDescriptions ? 'w-[260px]' : 'w-[220px]'" :style="slashMenuStyle"
      @mousedown.stop>
      <!-- 顶部：仅保留搜索状态，极简。 -->
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line/40 px-3">
        <span
          class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-ink/10 font-mono text-[11px] font-bold text-ink">
          /
        </span>
        <span class="min-w-0 flex-1 truncate text-[12px] text-muted">
          {{ slashQuery || '输入以搜索…' }}
        </span>
        <span class="shrink-0 font-mono text-[10px] text-muted/60">ESC</span>
      </div>

      <!-- 命令列表：无边框、轻分组。 -->
      <div v-if="filteredCommands.length"
        class="flex max-h-[230px] min-h-0 flex-col py-2">
        <!-- 留白放在滚动层外，滚动到任意位置时首尾可见项都不会贴住边界。 -->
        <div class="editor-scroll flex min-h-0 flex-col gap-1 overflow-y-auto">
          <template v-for="group in commandGroups" :key="group.name">
            <div v-if="group.commands.length" class="flex flex-col">
              <div class="flex h-6 shrink-0 items-center px-3 pt-1">
                <span class="text-[10px] font-medium tracking-wide text-muted/80">{{ group.name }}</span>
              </div>
              <button v-for="command in group.commands" :key="command.item.id" type="button"
                class="group/item mx-1 flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-left transition-colors duration-75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                :data-slash-selected="command.index === selectedCommandIndex || undefined"
                :class="command.index === selectedCommandIndex ? 'bg-control-active text-ink' : 'text-secondary hover:bg-control-hover hover:text-ink'"
                @mouseenter="selectedCommandIndex = command.index" @mousedown.prevent="executeSlashCommand(command.item)">
                <!-- 图标：选中时微加深色底，悬停时柔化。 -->
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-75"
                  :class="command.index === selectedCommandIndex ? 'bg-ink/10 text-ink' : 'bg-control/60 text-icon group-hover/item:bg-control group-hover/item:text-ink'">
                  <Icon :icon="command.item.icon" :size="15" />
                </span>
                <!-- 名称 + 描述。 -->
                <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <!-- 命令名称使用更深的颜色和半粗字重，与辅助说明形成明确层级。 -->
                  <span class="shrink-0 text-[12px] font-semibold text-ink">{{ command.item.label }}</span>
                  <span v-if="settings.showSlashCommandDescriptions"
                    class="min-w-0 flex-1 truncate text-[11px] text-muted/50">
                    {{ command.item.description }}
                  </span>
                </span>
                <!-- 选中态指示条 -->
                <span v-if="command.index === selectedCommandIndex" class="h-3 w-0.5 shrink-0 rounded-full bg-ink/40" />
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="flex flex-col items-center justify-center gap-1.5 py-8 text-muted">
        <Icon icon="lucide:search-x" :size="20" class="text-muted/50" />
        <span class="text-[11px]">没有匹配的命令</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BubbleMenu, EditorContent } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, nextTick, ref, watch } from 'vue'
import { useMarkdownEditor } from '../composables/useEditor'
import { useSettings } from '../composables/useSettings'
import type { EditorBodyFont, EditorLineWidth, PreviewZoomLevel } from '../composables/useSettings'
import InsertLinkPanel from './editor/InsertLinkPanel.vue'
import type { EditorHandle } from '../types/editor'
import { mediaService } from '../services/mediaService'
import { windowService } from '../services/windowService'

const { settings } = useSettings()

// 排版设置通过 CSS 变量作用于编辑区，避免为每种组合生成额外类名。
// 变量声明在 typography-pane 容器上，导出文档不包含该容器类，保持独立排版。
const BODY_FONT_STACKS: Record<EditorBodyFont, string> = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif",
  serif: "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', 'Noto Serif SC', serif",
  sans: "'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  mono: "'SF Mono', 'Fira Code', Consolas, 'Menlo', monospace",
}

// 行宽表示正文列的最大宽度；box-border 下盒子总宽 = 列宽 + 两侧留白。
const LINE_WIDTH_STYLES: Record<EditorLineWidth, { width: string; gutter: string }> = {
  narrow: { width: '720px', gutter: '40px' },
  medium: { width: '880px', gutter: '40px' },
  wide: { width: '1040px', gutter: '40px' },
  full: { width: '100%', gutter: '80px' },
}

const ZOOM_LEVELS: Record<PreviewZoomLevel, string> = {
  small: '0.8',
  standard: '1',
  large: '1.2',
  xlarge: '1.4',
}

const typographyStyle = computed(() => {
  const lineWidth = LINE_WIDTH_STYLES[settings.lineWidth]
  return {
    '--editor-font-family': BODY_FONT_STACKS[settings.bodyFont],
    '--editor-font-size': `${settings.bodyFontSize}px`,
    '--editor-line-width': lineWidth.width,
    '--editor-line-gutter': lineWidth.gutter,
    '--editor-zoom': ZOOM_LEVELS[settings.previewZoom],
  }
})

// Props
const props = defineProps<{
  initialContent?: string
  currentFilePath: string | null
  active: boolean
}>()

// Emits
const emit = defineEmits<{
  'update:content': [content: string]
}>()

// 使用编辑器组合式函数
const {
  editor,
  slashMenuVisible,
  slashMenu,
  slashQuery,
  linkInsertVisible,
  linkInsertUrl,
  linkInsertLabel,
  linkInsertError,
  selectedCommandIndex,
  activeBlock,
  blockControlVisible,
  blockMenuVisible,
  dropIndicator,
  filteredCommands,
  commandGroups,
  slashMenuStyle,
  blockControlStyle,
  blockMenuStyle,
  dropIndicatorStyle,
  activeBlockCollapsed,
  activeBlockIsFirst,
  activeBlockIsLast,
  closeSlashMenu,
  executeSlashCommand,
  cancelLinkInsert,
  submitLinkInsert,
  refreshBlockControlPosition,
  handleEditorMouseMove,
  handleEditorMouseLeave,
  handleBlockControlLeave,
  toggleBlockMenu,
  closeBlockMenu,
  addBlockAfter,
  duplicateActiveBlock,
  deleteActiveBlock,
  moveActiveBlock,
  copyActiveBlockText,
  toggleActiveHeading,
  handleBlockDragStart,
  handleBlockDragOver,
  finishBlockDrag,
  handleBlockDrop,
  scrollToHeading,
} = useMarkdownEditor(
  () => props.initialContent ?? '',
  emit,
  () => props.currentFilePath,
  () => props.active,
)

// 菜单动作保持短动词，排列遵循“移动、复制、删除”的使用频率和风险层级。
const blockActions = [
  { icon: 'lucide:file-plus-2', label: '下方新增', run: addBlockAfter },
  { icon: 'lucide:arrow-up', label: '上移', run: () => moveActiveBlock('up'), disabled: () => activeBlockIsFirst.value },
  { icon: 'lucide:arrow-down', label: '下移', run: () => moveActiveBlock('down'), disabled: () => activeBlockIsLast.value },
  { icon: 'lucide:copy', label: '复制文本', run: copyActiveBlockText, divideBefore: true },
  { icon: 'lucide:copy-plus', label: '生成副本', run: duplicateActiveBlock },
  { icon: 'lucide:trash-2', label: '删除', run: deleteActiveBlock, danger: true, divideBefore: true },
]

const editorShell = ref<HTMLElement | null>(null)
const blockMenu = ref<HTMLElement | null>(null)

// 菜单使用 fixed 定位，需要按编辑区而非整个窗口限制上下边界，避免覆盖底部状态栏。
const safeBlockMenuStyle = computed(() => {
  const desiredTop = Number.parseFloat(blockMenuStyle.value.top)
  const editorRect = editorShell.value?.getBoundingClientRect()
  const menuHeight = blockMenu.value?.offsetHeight ?? 0
  if (!editorRect || menuHeight === 0) return blockMenuStyle.value

  const verticalGap = 8
  const highestTop = editorRect.top + verticalGap
  const lowestTop = editorRect.bottom - menuHeight - verticalGap
  return {
    left: blockMenuStyle.value.left,
    top: `${Math.max(highestTop, Math.min(desiredTop, lowestTop))}px`,
  }
})

const linkInsertStyle = computed(() => ({
  left: `${Math.max(12, Math.min(Number.parseFloat(slashMenuStyle.value.left), window.innerWidth - 332))}px`,
  top: slashMenuStyle.value.top,
}))

// 表格工具栏按“行、列、单元格、整表”排列，标签保持短小，完整含义放在悬停提示中。
const tableActions = [
  { icon: 'mdi:table-row-plus-before', title: '在上方添加一行', canRun: () => editor.value?.can().addRowBefore() ?? false, run: () => editor.value?.chain().focus().addRowBefore().run(), danger: false },
  { icon: 'mdi:table-row-plus-after', title: '在下方添加一行', canRun: () => editor.value?.can().addRowAfter() ?? false, run: () => editor.value?.chain().focus().addRowAfter().run(), danger: false },
  { icon: 'mdi:table-row-remove', title: '删除当前行', canRun: () => editor.value?.can().deleteRow() ?? false, run: () => editor.value?.chain().focus().deleteRow().run(), danger: true },
  { icon: 'mdi:table-column-plus-before', title: '在左侧添加一列', canRun: () => editor.value?.can().addColumnBefore() ?? false, run: () => editor.value?.chain().focus().addColumnBefore().run(), danger: false },
  { icon: 'mdi:table-column-plus-after', title: '在右侧添加一列', canRun: () => editor.value?.can().addColumnAfter() ?? false, run: () => editor.value?.chain().focus().addColumnAfter().run(), danger: false },
  { icon: 'mdi:table-column-remove', title: '删除当前列', canRun: () => editor.value?.can().deleteColumn() ?? false, run: () => editor.value?.chain().focus().deleteColumn().run(), danger: true },
  { icon: 'lucide:panel-top', title: '切换首行为表头', canRun: () => editor.value?.can().toggleHeaderRow() ?? false, run: () => editor.value?.chain().focus().toggleHeaderRow().run(), danger: false },
  { icon: () => editor.value?.can().mergeCells() ? 'lucide:combine' : 'lucide:split-square-horizontal', title: '合并或拆分单元格', canRun: () => editor.value?.can().mergeOrSplit() ?? false, run: () => editor.value?.chain().focus().mergeOrSplit().run(), danger: false },
  { icon: 'lucide:trash-2', title: '删除整个表格', canRun: () => editor.value?.can().deleteTable() ?? false, run: () => editor.value?.chain().focus().deleteTable().run(), danger: true },
]

// 分隔“行、列、单元格、整表”四类操作，图标紧凑但功能层级仍然清晰。
const tableActionSeparators = [3, 6, 8]

const shouldShowTableMenu = (): boolean => editor.value?.isActive('table') ?? false

interface ActiveLink {
  href: string
  from: number
  to: number
  left: number
  top: number
}

const activeLink = ref<ActiveLink | null>(null)
const editingLink = ref(false)
const linkDraft = ref('')
const linkCopied = ref(false)
const linkInput = ref<HTMLInputElement | null>(null)
let linkCloseTimer: ReturnType<typeof setTimeout> | null = null

const linkMenuStyle = computed(() => ({
  left: `${activeLink.value?.left ?? 0}px`,
  top: `${activeLink.value?.top ?? 0}px`,
}))

// 从链接 DOM 反查编辑器位置，后续编辑和取消链接都只作用于当前链接文本。
const handleLinkMouseOver = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-link-menu]')) return
  const anchor = target?.closest('.tiptap a') as HTMLAnchorElement | null
  if (!anchor || !editor.value) {
    scheduleLinkMenuClose()
    return
  }

  // 目录锚点只负责文档内跳转，不显示用于编辑普通链接的操作浮层。
  if ((anchor.getAttribute('href') ?? '').startsWith('#')) {
    activeLink.value = null
    editingLink.value = false
    return
  }

  cancelLinkMenuClose()
  const rect = anchor.getBoundingClientRect()
  activeLink.value = {
    // 读取原始属性，避免浏览器把相对路径展开成 Electron 页面绝对地址。
    href: anchor.getAttribute('href') ?? '',
    from: editor.value.view.posAtDOM(anchor, 0),
    to: editor.value.view.posAtDOM(anchor, anchor.childNodes.length),
    left: Math.max(12, Math.min(rect.left, window.innerWidth - 460)),
    top: rect.bottom + 54 < window.innerHeight ? rect.bottom + 6 : rect.top - 48,
  }
  editingLink.value = false
  linkCopied.value = false
}

// Markdown 目录通常使用 GitHub 风格的标题锚点：保留中文，把空白转为连字符并移除标点。
// 同名标题从第二个开始追加 -1、-2，保证手写目录和常见 Markdown 平台的行为一致。
const createHeadingAnchors = (): Map<string, HTMLElement> => {
  const anchors = new Map<string, HTMLElement>()
  const occurrences = new Map<string, number>()
  const headingElements = editor.value?.view.dom.querySelectorAll<HTMLElement>(
    'h1, h2, h3, h4, h5, h6',
  ) ?? []

  headingElements.forEach((heading) => {
    const baseAnchor = (heading.textContent ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}\p{M}_-]/gu, '')
    if (!baseAnchor) return

    const occurrence = occurrences.get(baseAnchor) ?? 0
    occurrences.set(baseAnchor, occurrence + 1)
    const anchor = occurrence === 0 ? baseAnchor : `${baseAnchor}-${occurrence}`
    anchors.set(anchor, heading)
  })

  return anchors
}

const openHeadingAnchor = (href: string): void => {
  // 浏览器读取 href 属性时可能返回百分号编码的中文，先还原后再匹配标题。
  let anchor = href.slice(1)
  try {
    anchor = decodeURIComponent(anchor)
  } catch {
    // 非法百分号编码无法对应合法标题锚点，保持未命中即可。
  }

  const targetHeading = createHeadingAnchors().get(anchor.toLowerCase())
  targetHeading?.scrollIntoView({ block: 'start' })
}

const openMarkdownLink = async (href: string): Promise<void> => {
  if (/^(?:https?:|mailto:)/i.test(href)) {
    await windowService.openExternalLink(href)
    return
  }
  if (href.startsWith('#')) {
    openHeadingAnchor(href)
    return
  }

  try {
    await mediaService.openLocalLink(href, props.currentFilePath)
  } catch (error) {
    console.error('打开本地链接失败:', error)
  }
}

// 网页交给系统浏览器，相对链接则按当前 Markdown 文件所在目录解析。
const handleLinkClick = async (event: MouseEvent): Promise<void> => {
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-link-menu]')) return
  const anchor = target?.closest('.tiptap a') as HTMLAnchorElement | null
  if (!anchor) return

  event.preventDefault()
  await openMarkdownLink(anchor.getAttribute('href') ?? '')
}

// 附件卡片由编辑器节点渲染，事件委托可以同时覆盖新插入和重新载入的附件。
const openAttachment = async (element: HTMLElement): Promise<void> => {
  const url = element.dataset.url
  if (!url) return
  const error = await mediaService.openFile(url, props.currentFilePath)
  if (error) console.error('打开附件失败:', error)
}

const handleEditorContentClick = async (event: MouseEvent): Promise<void> => {
  closeBlockMenu()
  const target = event.target as HTMLElement | null
  const openButton = target?.closest('[data-xmd-attachment-open]') as HTMLElement | null
  const attachment = openButton?.closest('[data-xmd-attachment]') as HTMLElement | null
  if (openButton && attachment) {
    event.preventDefault()
    event.stopPropagation()
    await openAttachment(attachment)
    return
  }
  await handleLinkClick(event)
}

const handleAttachmentKeydown = async (event: KeyboardEvent): Promise<void> => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const target = event.target as HTMLElement | null
  const openButton = target?.closest('[data-xmd-attachment-open]') as HTMLElement | null
  const attachment = openButton?.closest('[data-xmd-attachment]') as HTMLElement | null
  if (!openButton || !attachment) return
  event.preventDefault()
  await openAttachment(attachment)
}

const cancelLinkMenuClose = (): void => {
  if (linkCloseTimer) clearTimeout(linkCloseTimer)
  linkCloseTimer = null
}

const scheduleLinkMenuClose = (): void => {
  cancelLinkMenuClose()
  linkCloseTimer = setTimeout(() => {
    activeLink.value = null
    editingLink.value = false
  }, 160)
}

const handleEditorAreaLeave = (event: MouseEvent): void => {
  handleEditorMouseLeave(event)
  scheduleLinkMenuClose()
}

const selectActiveLink = () => {
  if (!editor.value || !activeLink.value) return null
  return editor.value.chain().focus().setTextSelection({
    from: activeLink.value.from,
    to: activeLink.value.to,
  }).extendMarkRange('link')
}

const openActiveLink = async (): Promise<void> => {
  if (activeLink.value) await openMarkdownLink(activeLink.value.href)
}

// 富文本视图通过滚动容器的阅读进度与源码视图保持大致相同的位置。
const getScrollProgress = (): number => {
  const element = editorShell.value?.querySelector<HTMLElement>('.editor-scroll')
  if (!element) return 0
  const scrollableHeight = element.scrollHeight - element.clientHeight
  return scrollableHeight > 0 ? element.scrollTop / scrollableHeight : 0
}

const setScrollProgress = (progress: number): void => {
  const element = editorShell.value?.querySelector<HTMLElement>('.editor-scroll')
  if (!element) return
  const scrollableHeight = element.scrollHeight - element.clientHeight
  element.scrollTop = Math.max(0, Math.min(1, progress)) * scrollableHeight
}

const startEditLink = async (): Promise<void> => {
  if (!activeLink.value) return
  linkDraft.value = activeLink.value.href
  editingLink.value = true
  await nextTick()
  linkInput.value?.select()
}

const cancelEditLink = (): void => {
  editingLink.value = false
}

const saveLink = (): void => {
  const href = linkDraft.value.trim()
  if (!href) return
  selectActiveLink()?.setLink({ href }).run()
  if (activeLink.value) activeLink.value.href = href
  editingLink.value = false
}

const copyActiveLink = async (): Promise<void> => {
  if (!activeLink.value) return
  await navigator.clipboard.writeText(activeLink.value.href)
  linkCopied.value = true
}

const removeActiveLink = (): void => {
  selectActiveLink()?.unsetLink().run()
  activeLink.value = null
}

// 暴露方法给父组件
defineExpose<EditorHandle>({
  scrollToHeading,
  getScrollProgress,
  setScrollProgress,
  getEditor: () => editor.value ?? null,
} as EditorHandle)
</script>

<!--
  TipTap 编辑器深度样式 — 针对第三方 DOM 内容，无法用 Tailwind 工具类替代。
  使用 <style> 非 scoped（通过选择器限定范围），保留原有样式设计。
-->
<style>
/* ===== 编辑器主体 ===== */
.tiptap {
  outline: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei',
    'PingFang SC', 'Hiragino Sans GB', sans-serif;
  font-size: 15px;
  line-height: 1.75;
  color: var(--color-ink);
  word-break: break-word;
}

/*
 * 排版设置（字号 / 字体 / 行宽 / 预览缩放）全部由 typography-pane 容器上的
 * CSS 变量驱动，只作用于编辑区；导出文档不带该容器类，排版保持独立。
 * 缩放使用 Chromium 的 zoom 布局缩放，滚动高度与光标坐标会自动跟随。
 */
.typography-pane .prose-editor {
  max-width: var(--editor-line-width, 100%);
  margin-left: auto;
  margin-right: auto;
  padding-left: var(--editor-line-gutter, 80px);
  padding-right: var(--editor-line-gutter, 80px);
}

.typography-pane .tiptap {
  font-family: var(--editor-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI',
    'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif);
  font-size: var(--editor-font-size, 15px);
  zoom: var(--editor-zoom, 1);
}

/* ===== 段落 ===== */
.tiptap p {
  margin-bottom: 0.6em;
}

/* ===== 标题 ===== */
.tiptap h1,
.tiptap h2,
.tiptap h3,
.tiptap h4,
.tiptap h5,
.tiptap h6 {
  color: var(--color-ink);
  line-height: 1.4;
}

.tiptap h1 {
  font-size: 1.75em;
  font-weight: 700;
  margin: 1.4em 0 0.5em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--color-line);
}

.tiptap h2 {
  font-size: 1.4em;
  font-weight: 600;
  margin: 1.3em 0 0.4em;
  padding-bottom: 0.2em;
  border-bottom: 1px solid var(--color-line);
}

.tiptap h3 {
  font-size: 1.2em;
  font-weight: 600;
  margin: 1.2em 0 0.4em;
}

.tiptap h4 {
  font-size: 1.05em;
  font-weight: 600;
  margin: 1.1em 0 0.3em;
}

/* 折叠属于编辑视图状态，隐藏章节节点时不会改写或删除 Markdown 内容。 */
.tiptap .is-section-hidden {
  display: none;
}

/* ===== 列表 ===== */
.tiptap ul,
.tiptap ol {
  padding-left: 1.6em;
  margin: 0.35em 0 0.7em;
}

/* Tailwind 基础样式会清除列表标记，这里为编辑器内容恢复圆点和数字。 */
.tiptap ul {
  list-style-type: disc;
}

.tiptap ol {
  list-style-type: decimal;
}

.tiptap li {
  margin-bottom: 0.18em;
  padding-left: 0.2em;
}

/* 嵌套列表收紧上下留白，使层级清楚但不显得松散。 */
.tiptap li > ul,
.tiptap li > ol {
  margin: 0.15em 0 0.2em;
}

/* 任务列表拥有复选框，不再继承普通无序列表的圆点和缩进。 */
.tiptap ul[data-type='taskList'] {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
  padding-left: 0;
  margin: 0.4em 0 0.75em;
  list-style: none;
}

.tiptap ul[data-type='taskList'] > li {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-start;
  gap: 0.6em;
  margin: 0;
  padding: 0;
}

.tiptap ul[data-type='taskList'] > li > label {
  display: flex;
  flex: none;
  align-items: center;
  height: 1.7em;
}

.tiptap ul[data-type='taskList'] > li > label input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin: 0;
  appearance: none;
  flex: none;
  border: 1px solid var(--color-muted);
  border-radius: 4px;
  background-color: transparent;
  cursor: pointer;
}

/* 使用主题色绘制勾选态，避免系统复选框出现突兀的蓝色。 */
.tiptap ul[data-type='taskList'] > li > label input[type='checkbox']:checked {
  border-color: var(--color-accent);
  background-color: var(--color-accent);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='white' d='M6.55 11.2 3.4 8.05l1.1-1.1 2.05 2.05 4.95-4.95 1.1 1.1z'/%3E%3C/svg%3E");
  background-position: center;
  background-repeat: no-repeat;
  background-size: 14px 14px;
}

.tiptap ul[data-type='taskList'] > li > div {
  display: block;
  min-width: 0;
  flex: 1;
}

.tiptap ul[data-type='taskList'] > li > div > p {
  margin: 0;
}

.tiptap ul[data-type='taskList'] > li[data-checked='true'] > div {
  color: var(--color-muted);
  text-decoration: line-through;
  text-decoration-color: var(--color-muted);
}

/* ===== 引用块 ===== */
.tiptap blockquote {
  border-left: 3px solid var(--color-line);
  padding: 4px 16px;
  margin: 0.8em 0;
  color: var(--color-muted);
  background-color: transparent;
}

.tiptap blockquote p {
  margin-bottom: 0.3em;
}

/* ===== 行内代码 ===== */
.tiptap code {
  background-color: var(--color-code-bg);
  padding: 0.1em 0.3em;
  border-radius: 3px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', 'Menlo', monospace;
  font-size: 0.9em;
  color: var(--color-code-text);
}

/* ===== 代码块 ===== */
.tiptap pre {
  background-color: var(--color-code-block-bg);
  border: 1px solid var(--color-line);
  padding: 12px 16px;
  border-radius: 3px;
  overflow-x: auto;
  margin: 0.8em 0;
  line-height: 1.5;
  font-size: 0.9em;
}

.tiptap pre code {
  background-color: transparent;
  padding: 0;
  color: var(--color-ink);
  font-size: inherit;
}

/*
 * 代码高亮会为关键字、字符串等内容设置不同文字色。
 * 选中代码时统一使用高对比文字色，避免高亮色与选区背景混在一起。
 */
.tiptap pre code ::selection,
.tiptap pre code::selection {
  background-color: var(--color-link);
  color: var(--color-inverse);
}

/* ===== 图片 ===== */
.tiptap img {
  max-width: 100%;
  height: auto;
  margin: 0.5em 0;
  display: block;
}

/*
 * 原生文字选区无法覆盖图片、视频和附件等不可编辑节点。
 * 节点单选与 Ctrl+A 全选共用蓝色整块描边，并与内容留出间距。
 * 这样深色视频边缘不会与选区融在一起，视觉上也比黑色焦点框更轻。
 */
.tiptap [data-xmd-image].ProseMirror-selectednode,
.tiptap [data-xmd-video].ProseMirror-selectednode,
.tiptap [data-xmd-attachment].ProseMirror-selectednode,
.tiptap.is-all-selected [data-xmd-image],
.tiptap.is-all-selected [data-xmd-video],
.tiptap.is-all-selected [data-xmd-attachment] {
  @apply outline outline-2 outline-offset-[3px] outline-link;
}

/* 文件卡片再增加整块底色，避免选中反馈只落在文件名文字上。 */
.tiptap [data-xmd-attachment].ProseMirror-selectednode,
.tiptap.is-all-selected [data-xmd-attachment] {
  @apply border-link bg-selected;
}

/* ===== 表格 ===== */
.tiptap table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  margin: 1em 0;
  table-layout: fixed;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  overflow: hidden;
}

.tiptap th,
.tiptap td {
  position: relative;
  min-width: 96px;
  height: 42px;
  border-right: 1px solid var(--color-line);
  border-bottom: 1px solid var(--color-line);
  padding: 8px 12px;
  text-align: left;
  vertical-align: top;
}

.tiptap tr:last-child th,
.tiptap tr:last-child td {
  border-bottom: 0;
}

.tiptap th:last-child,
.tiptap td:last-child {
  border-right: 0;
}

.tiptap th {
  background-color: var(--color-toolbar);
  border-bottom: 1px solid var(--color-line);
  color: var(--color-ink);
  font-weight: 600;
}

.tiptap th p,
.tiptap td p {
  margin: 0;
}

.tiptap .selectedCell {
  background-color: var(--color-selected);
}

.tiptap .column-resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  bottom: 0;
  width: 4px;
  background-color: var(--color-accent);
  pointer-events: none;
}

.tiptap.resize-cursor {
  cursor: col-resize;
}

/* ===== 分割线 ===== */
.tiptap hr {
  display: block;
  border: none;
  border-top: 1px solid var(--color-line);
  margin: 1.5em 0;
  height: 0;
  overflow: visible;
}

.tiptap hr::before {
  content: '';
  display: block;
}

/* ===== 链接 ===== */
.tiptap a {
  color: var(--color-link);
  text-decoration-line: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  cursor: pointer;
}

.tiptap a:hover {
  color: var(--color-link-hover);
  text-decoration-thickness: 2px;
}

/* 文档内目录保留跳转能力，但视觉上作为普通目录文字展示。 */
.tiptap a[href^='#'],
.tiptap a[href^='#']:hover {
  color: inherit;
  text-decoration-line: none;
}

/* ===== 高亮 ===== */
.tiptap mark {
  background-color: var(--color-mark-bg);
  padding: 0.05em 0.15em;
  border-radius: 2px;
}

/* ===== Placeholder ===== */
.tiptap p.is-editor-empty:first-child::before {
  color: var(--color-placeholder);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

/* ===== 查找替换高亮 ===== */
/* 匹配项与当前项使用不同强度，避免与文字选区高亮混淆。 */
.xmd-find-match {
  background-color: rgba(255, 205, 40, 0.35);
  border-radius: 2px;
}

.xmd-find-current {
  background-color: rgba(255, 130, 40, 0.45);
  border-radius: 2px;
}
</style>
