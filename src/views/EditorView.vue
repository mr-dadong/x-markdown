<template>
    <div class="flex h-screen flex-col overflow-hidden bg-paper text-ink">
        <AppHeader :is-dark-theme="isDarkTheme" :has-update="hasUpdate" @toggle-theme="toggleTheme"
            @open-settings="openGeneralSettings" @open-update="openUpdateModal" @open-ai="openAiChat" />

        <div class="flex flex-1 overflow-hidden">
            <Sidebar v-if="isSidebarVisible" :current-file-path="currentFilePath" :content="currentContent"
                @open-file="handleOpenFileFromSidebar" @scroll-to="handleScrollToHeading" />
            <!-- min-w-0 允许编辑区在 flex 布局中正确收缩，避免右侧残留空白。 -->
            <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-paper">
                <DocumentBar v-if="isDocumentOpen" :documents="documents" :active-document-id="activeDocumentId"
                    :get-document-title="getDocumentTitle" @activate="activateDocument" @close="closeDocument"
                    @new-file="handleNewFile" @reorder="reorderDocument" @close-others="closeOtherDocuments"
                    @close-left="closeLeftDocuments" @close-right="closeRightDocuments" @close-all="closeAllDocuments"
                    @close-saved="closeSavedDocuments" @save="saveFile()" @save-as="saveFile(true)"
                    @show-in-explorer="showDocumentInExplorer" />
                <FindReplacePanel :controller="findReplaceController" />
                <MarkdownEditor v-if="isDocumentOpen" ref="editorRef" :initial-content="currentContent"
                    :current-file-path="currentFilePath" :active="!isSourceMode" v-show="!isSourceMode"
                    :modal-open="isSettingsOpen || isUpdateModalOpen"
                    @update:content="handleContentUpdate" @ai-action="handleAiAction"
                    @open-ai-panel="isAiChatOpen = true" @open-settings="openAiSettings"
                    @add-to-selection="handleAddToSelection" />
                <MarkdownSourceEditor v-if="isDocumentOpen" v-show="isSourceMode" ref="sourceEditorRef"
                    :content="currentContent" :is-dark-theme="isDarkTheme" @update:content="handleContentUpdate" />
                <div v-if="!isDocumentOpen"
                    class="editor-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8 select-none"
                    @dragover.prevent="handleWelcomeDragOver" @drop.prevent="handleWelcomeDrop">
                    <!-- m-auto：内容不足一屏时整体垂直居中；内容超高时自动回退为顶部对齐，
                         配合外层 overflow-y-auto 可完整滚动，避免居中溢出把顶部品牌区裁掉。 -->
                    <div class="m-auto flex w-full max-w-[460px] flex-col items-center text-center">
                        <!-- 使用正式应用图标建立品牌识别，按钮内仍保留“新建文档”的功能图标。 -->
                        <!-- 图片元素默认允许原生拖拽，显式关闭以免拖出品牌图标的半透明预览。 -->
                        <img :src="appIcon" alt="XMD" draggable="false" class="h-20 w-20 rounded-[22px]" />
                        <p class="mt-5 text-[18px] font-semibold tracking-tight text-ink">开始编辑</p>
                        <p class="mt-1.5 text-[13px] leading-5 text-muted">新建一份 Markdown 文稿，或继续编辑本地文档</p>
                        <div class="mt-6 flex items-center gap-3">
                            <button type="button"
                                class="flex h-9 items-center justify-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                @click="handleNewFile">
                                <Icon icon="lucide:file-plus-2" :size="16" />
                                <span>新建文档</span>
                            </button>
                            <button type="button"
                                class="flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 text-[13px] font-medium text-secondary hover:border-accent hover:bg-selected hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                @click="handleOpenFile">
                                <Icon icon="lucide:folder-open" :size="16" />
                                <span>打开文档</span>
                            </button>
                        </div>
                        <p class="mt-4 font-mono text-[10px] tracking-wide text-muted">支持 .md 与 .markdown 文件</p>

                        <!-- 最近打开：点击直接打开，悬停可移除单项或清空全部。
                             首页默认只展示最近 5 条，避免挤占品牌区；完整记录仍可在
                             文件菜单的“最近打开”中查看。 -->
                        <div v-if="visibleRecentFiles.length" class="mt-8 w-full text-left">
                            <div class="flex items-center justify-between px-1 pb-1.5">
                                <span
                                    class="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-muted">
                                    <Icon icon="lucide:history" :size="13" />
                                    <span>最近打开</span>
                                </span>
                                <button type="button"
                                    class="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-control-hover hover:text-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                                    @click="handleClearRecentFiles">清空</button>
                            </div>
                            <div
                                class="editor-scroll flex max-h-[min(45vh,340px)] flex-col gap-0.5 overflow-y-auto overscroll-contain pr-1">
                                <button v-for="filePath in visibleRecentFiles" :key="filePath" type="button"
                                    class="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-control-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                                    @click="handleOpenRecentFile(filePath)">
                                    <Icon icon="lucide:file-text" :size="15" class="shrink-0 text-muted" />
                                    <span class="min-w-0 flex-1">
                                        <span
                                            class="block truncate text-[13px] font-medium text-secondary group-hover:text-ink">{{
                                            getFileName(filePath) }}</span>
                                        <span class="block truncate text-[11px] text-muted">{{ filePath }}</span>
                                    </span>
                                    <span role="button" tabindex="-1" title="从最近列表移除"
                                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-control hover:text-ink"
                                        @click.stop="handleRemoveRecentFile(filePath)">
                                        <Icon icon="lucide:x" :size="13" />
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
            <!-- Chat 侧栏：放在 flex 行内，与编辑区并列 -->
            <AiChatSidebar :document-open="isDocumentOpen" :get-document-context="getAiDocumentContext"
                :get-selection="getAiSelection" :get-cursor-offset="getAiCursorOffset"
                :insert-at-cursor="insertAiAtCursor" :replace-selection="replaceAiSelection" :get-file-path="getAiFilePath"
                :pending-selections="pendingSelections" @clear-pending-selections="clearPendingSelections"
                @remove-pending-selection="removePendingSelection"
                @close="isAiChatOpen = false" @open-settings="openAiSettings" />
        </div>

        <AppStatusBar :line-count="documentStats.lineCount" :word-count="documentStats.wordCount"
            :character-count="documentStats.characterCount" :is-modified="isModified"
            :sidebar-visible="isSidebarVisible" :source-mode="isSourceMode" :document-open="isDocumentOpen"
            @toggle-sidebar="toggleSidebar" @toggle-source-mode="toggleSourceMode" />
        <SettingsModal />
        <UpdateModal />
        <ConfirmDialog />
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import appIcon from '../../build/icons/256x256.png'
import AppHeader from '../components/AppHeader.vue'
import AppStatusBar from '../components/AppStatusBar.vue'
import AiChatSidebar from '../components/ai/AiChatSidebar.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import DocumentBar from '../components/DocumentBar.vue'
import FindReplacePanel from '../components/FindReplacePanel.vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import MarkdownSourceEditor from '../components/MarkdownSourceEditor.vue'
import Sidebar from '../components/Sidebar.vue'
import SettingsModal from '../components/SettingsModal.vue'
import UpdateModal from '../components/UpdateModal.vue'
import { useDocument } from '../composables/useDocument'
import { buildExportDocx, buildExportHtml, buildExportText, buildExportZip } from '../composables/useExport'
import { useFindReplace } from '../composables/useFindReplace'
import type { AiEditAction } from '../types/ai'
import { useRecentFiles } from '../composables/useRecentFiles'
import { useSettings } from '../composables/useSettings'
import { overlayState } from '../modules/overlayState'
import { useTheme } from '../composables/useTheme'
import { useUpdater } from '../composables/useUpdater'
import { IPC_CHANNELS } from '../constants/ipcChannels'
import { documentService } from '../services/documentService'
import { exportService } from '../services/exportService'
import { fileSystemService } from '../services/fileSystemService'
import { getFileName } from '../utils/file'
import { normalizeAiMarkdown } from '../utils/aiMarkdown'
import { matchesShortcut } from '../utils/shortcuts'
import { blockFractionToSourceLine, getTopLevelBlockRanges, mapBlockIndex, sourceLineToBlockFraction } from '../modules/viewSync'
import type { EditorHandle, SourceEditorHandle, ViewportAnchor } from '../types/editor'

const editorRef = ref<EditorHandle | null>(null)
const sourceEditorRef = ref<SourceEditorHandle | null>(null)
const isSidebarVisible = ref(false)
const isSettingsOpen = overlayState.settingsOpen
const settingsInitialSection = overlayState.settingsSection
const isAiChatOpen = overlayState.aiChatOpen
const pendingSelections = ref<string[]>([])
const { settings } = useSettings()
const isSourceMode = ref(settings.editorMode === 'source')
const documentModes = new Map<number, boolean>()

// 标签页视图状态：每个打开的文档独立保存自己的阅读位置，
// 切换标签时保存旧文档锚点、恢复新文档锚点，避免超长文档来回切换时反复从头滚动。
interface DocumentViewState {
  // 渲染视图：视口顶部所在顶层块 + 块内偏移比例（与 viewSync 锚点体系一致）。
  renderedAnchor: ViewportAnchor | null
  // 源码视图：视口顶部行号（0 起始，与 markdown-it 一致）。
  sourceLine: number | null
}
const viewStates = new Map<number, DocumentViewState>()
// 跨标签查找跳转时由查找面板负责定位，跳过自动恢复避免互相覆盖。
let findReplaceNavigation = false
// 快速连续切换标签时只恢复最后一次激活的文档，避免旧回调覆盖新位置。
let restoreSequence = 0
const { isDarkTheme, toggleTheme } = useTheme()
const { hasUpdate, isUpdateModalOpen, checkForUpdates, openUpdateModal } = useUpdater()

// 顶部入口使用具名方法记录“点击已到达 Vue”与后续状态提交，
// 生产包再次出现问题时可以区分点击未触发和组件未渲染两类原因。
const openGeneralSettings = (): void => {
    settingsInitialSection.value = 'general'
    isSettingsOpen.value = true
}

// 点击右上角 AI 图标：开↔关切换，与快捷键 Ctrl+Shift+A 行为一致。
const openAiChat = (): void => {
isAiChatOpen.value = !isAiChatOpen.value
}

// 查找替换控制器：同时服务所见即所得与源码两种编辑模式。
// getSourceHandle 返回源码编辑器完整的 handle 引用，包括搜索装饰等方法。
// 文档状态（打开列表、当前标签、切换标签）也交给控制器，实现跨标签页查找：
// 关键词不在当前文档时，点击“下一个”会自动切换到包含匹配的标签页并定位。
const getSourceHandle = (): SourceEditorHandle | null => {
    return sourceEditorRef.value as SourceEditorHandle | null
}

const getAiSelection = (): string => {
    if (isSourceMode.value) return sourceEditorRef.value?.getSelectionText() ?? ''
    return editorRef.value?.getSelectionText() ?? ''
}

const getAiDocumentContext = (): string => currentContent.value

// 光标在 Markdown 源码中的字符偏移（富文本/源码模式分别由两个编辑器 handle 提供）。
const getAiCursorOffset = (): number | null => {
    if (isSourceMode.value) return sourceEditorRef.value?.getCursorOffset() ?? null
    return editorRef.value?.getCursorOffset() ?? null
}

const getAiFilePath = (): string | null => currentFilePath.value

const insertAiAtCursor = (text: string): void => {
  // 聊天插入的 AI 内容先归一化过度转义，源码模式与富文本模式统一受益
  const normalized = normalizeAiMarkdown(text)
  if (isSourceMode.value) {
    sourceEditorRef.value?.insertAtCursor(normalized)
    return
  }
  editorRef.value?.insertAtCursor(normalized)
}

const replaceAiSelection = (text: string): void => {
  const normalized = normalizeAiMarkdown(text)
  if (isSourceMode.value) {
    sourceEditorRef.value?.replaceSelection(normalized)
    return
  }
  editorRef.value?.replaceSelection(normalized)
}

// 选中文本后点击 AI 动作：打开 Chat 侧栏。
const handleAiAction = (action: AiEditAction): void => {
    isAiChatOpen.value = true
}

// 添加选中文本到 AI Chat 输入框
const handleAddToSelection = (text: string): void => {
    pendingSelections.value.push(text)
    isAiChatOpen.value = true
}

// 消费 pending selection 后清空
const clearPendingSelections = (): void => {
    pendingSelections.value = []
}

// 移除单个选区
const removePendingSelection = (index: number): void => {
    pendingSelections.value.splice(index, 1)
}

// 从 Chat 侧栏跳转到设置页的 AI 配置区。
const openAiSettings = (): void => {
    isAiChatOpen.value = false
    settingsInitialSection.value = 'ai'
    isSettingsOpen.value = true
}

// 关闭设置页时重置初始分区，下次打开默认回到通用。
const closeSettings = (): void => {
    isSettingsOpen.value = false
    settingsInitialSection.value = 'general'
}

const {
    currentContent,
    currentFilePath,
    documents,
    activeDocumentId,
    isDocumentOpen,
    isModified,
    documentStats,
    activateDocument,
    closeDocument,
    closeOtherDocuments,
    closeLeftDocuments,
    closeRightDocuments,
    closeSavedDocuments,
    closeAllDocuments,
    getDocumentTitle,
    handleContentUpdate,
    handleNewFile,
    reorderDocument,
    handleOpenFile,
    handleDroppedFiles,
    handleOpenFileFromSidebar,
    handleOpenRecentFile,
    saveFile,
} = useDocument()

const findReplaceController = useFindReplace(
    () => editorRef.value?.getEditor() ?? null,
    getSourceHandle,
    isSourceMode,
    () => documents.value,
    () => activeDocumentId.value,
    // 跨标签查找跳转时由查找面板负责定位，设置标志让标签恢复逻辑跳过自动恢复。
    (documentId: number) => {
        findReplaceNavigation = true
        activateDocument(documentId)
    },
)

const { recentFiles, loadRecentFiles, removeRecentFile, clearRecentFiles } = useRecentFiles()

// 首页最近打开默认只展示 5 条，避免挤占品牌区；完整记录仍保留在主进程数据与文件菜单中。
const MAX_RECENT_FILES_ON_HOME = 5
const visibleRecentFiles = computed(() => recentFiles.value.slice(0, MAX_RECENT_FILES_ON_HOME))

const handleRemoveRecentFile = (filePath: string): void => {
    void removeRecentFile(filePath)
}

const handleClearRecentFiles = (): void => {
    void clearRecentFiles()
}

// 在资源管理器中定位标签页对应的文件，未保存的新文档没有路径可定位。
const showDocumentInExplorer = async (documentId: number): Promise<void> => {
    const document = documents.value.find((item) => item.id === documentId)
    if (!document?.filePath) return
    try {
        await fileSystemService.showEntry(document.filePath)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await window.electronAPI.showErrorMessage('打开文件所在位置失败', message)
    }
}

const handleWelcomeDragOver = (event: DragEvent): void => {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

const handleWelcomeDrop = (event: DragEvent): void => {
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length > 0) void handleDroppedFiles(files)
}

const toggleSidebar = (): void => {
    isSidebarVisible.value = !isSidebarVisible.value
}

const toggleSourceMode = async (): Promise<void> => {
    if (!isDocumentOpen.value) return

    // 切换前先记录当前视图的阅读位置，切换后按顶层块映射换算到目标视图。
    // 顶层块是不受排版差异影响的最小对齐单位：图片占高、字体变大只会改变
    // 块内部的高度，块与块之间的先后顺序在两种视图中保持一致。
    const blockRanges = getTopLevelBlockRanges(currentContent.value)

    // 渲染 → 源码：锚点是视口顶部所在块，以及切入该块的深度比例。
    const renderedAnchor = isSourceMode.value
        ? null
        : editorRef.value?.getViewportAnchor() ?? null
    const renderedBlockCount = isSourceMode.value ? 0 : editorRef.value?.getBlockCount() ?? 0
    // 源码 → 渲染：锚点是视口顶部行号（0 起始）。
    const sourceLine = isSourceMode.value
        ? sourceEditorRef.value?.getViewportSourceLine() ?? null
        : null

    isSourceMode.value = !isSourceMode.value
    if (activeDocumentId.value !== null) {
        documentModes.set(activeDocumentId.value, isSourceMode.value)
    }

    // 等待目标视图完成显示和布局后，再恢复切换前的阅读位置。
    await nextTick()
    if (blockRanges.length === 0) return
    if (isSourceMode.value) {
        if (renderedAnchor === null) return
        const sourceBlockIndex = mapBlockIndex(renderedAnchor.index, renderedBlockCount, blockRanges.length)
        // 块内偏移也按比例换算成源码行，往返切换不会跳回块顶。
        const targetLine = blockFractionToSourceLine(blockRanges, sourceBlockIndex, renderedAnchor.fraction)
        sourceEditorRef.value?.scrollToSourceLine(targetLine)
    } else {
        if (sourceLine === null) return
        const { index, fraction } = sourceLineToBlockFraction(blockRanges, sourceLine)
        const targetBlockCount = editorRef.value?.getBlockCount() ?? 0
        editorRef.value?.scrollToBlockFraction(
            mapBlockIndex(index, blockRanges.length, targetBlockCount),
            fraction,
        )
    }
}

// 切换标签前保存旧文档的视图锚点，切换后恢复新文档的锚点。
// 锚点不依赖像素：渲染模式记录“顶层块 + 块内比例”，源码模式记录视口顶部行号，
// 文档内容变化（自动保存、外部修改）后仍能大致回到原阅读位置。
const saveViewState = (documentId: number): void => {
    // 关闭流程中旧文档已从列表移除，不再保存其状态。
    if (!documents.value.some((document) => document.id === documentId)) return
    const state = viewStates.get(documentId) ?? { renderedAnchor: null, sourceLine: null }
    if (isSourceMode.value) {
        state.sourceLine = sourceEditorRef.value?.getViewportSourceLine() ?? null
    } else {
        state.renderedAnchor = editorRef.value?.getViewportAnchor() ?? null
    }
    viewStates.set(documentId, state)
}

// 等目标文档内容载入完成、DOM 布局稳定后恢复阅读位置。
// 用微任务 + 宏任务组合等待，避免依赖 requestAnimationFrame——窗口隐藏或最小化时 rAF 不触发。
const restoreViewState = async (documentId: number): Promise<void> => {
    const sequence = ++restoreSequence
    // 跨标签查找跳转由查找面板负责定位，本次自动恢复直接跳过。
    if (findReplaceNavigation) {
        findReplaceNavigation = false
        return
    }
    await nextTick()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await nextTick()
    // 快速连续切换时只恢复最后一次激活的文档，避免旧回调覆盖新位置。
    if (sequence !== restoreSequence) return
    if (activeDocumentId.value !== documentId) return
    const state = viewStates.get(documentId)
    if (!state) return
    if (isSourceMode.value) {
        if (state.sourceLine !== null) sourceEditorRef.value?.scrollToSourceLine(state.sourceLine)
    } else if (state.renderedAnchor !== null) {
        editorRef.value?.scrollToBlockFraction(state.renderedAnchor.index, state.renderedAnchor.fraction)
    }
}

// 每个文档首次打开都严格采用设置中的默认模式，手动切换只影响当前文档；
// 切换标签时先保存旧文档锚点，再恢复新文档锚点。
watch(activeDocumentId, (documentId, previousDocumentId) => {
    if (previousDocumentId !== null && previousDocumentId !== documentId) {
        saveViewState(previousDocumentId)
    }
    if (documentId === null) return
    const savedMode = documentModes.get(documentId)
    isSourceMode.value = savedMode ?? settings.editorMode === 'source'
    if (savedMode === undefined) documentModes.set(documentId, isSourceMode.value)
    void restoreViewState(documentId)
})

// 关闭文档后清理对应的视图状态与编辑模式记忆，避免 Map 无限增长。
watch(documents, (list) => {
    const aliveIds = new Set(list.map((document) => document.id))
    for (const id of viewStates.keys()) {
        if (!aliveIds.has(id)) viewStates.delete(id)
    }
    for (const id of documentModes.keys()) {
        if (!aliveIds.has(id)) documentModes.delete(id)
    }
})

// 在窗口范围内监听快捷键，编辑器获得焦点时也可以收缩或展开侧边栏。
// 可自定义的动作（新建 / 打开 / 保存 / 侧边栏 / 编辑模式 / 设置）都读取设置页的配置。
const handleWindowKeydown = (event: KeyboardEvent): void => {
    // 对话框（设置、更新、确认）内的按键由组件自身处理，避免误触发全局快捷键。
    if ((event.target as HTMLElement | null)?.closest?.('[role="dialog"]')) return
    // 设置页是全屏遮罩，打开期间全局快捷键不响应，Esc 由设置页自己消费。
    if (isSettingsOpen.value) return

    // 查找面板打开时 Esc 优先关闭查找，回到正常的编辑状态。
    if (event.key === 'Escape' && findReplaceController.isOpen.value) {
        event.preventDefault()
        findReplaceController.close()
        return
    }

    if (matchesShortcut(event, settings.shortcuts.openSettings) && !event.repeat) {
        event.preventDefault()
        isSettingsOpen.value = true
        return
    }

    if (matchesShortcut(event, settings.shortcuts.newFile) && !event.repeat) {
        event.preventDefault()
        handleNewFile()
        return
    }

    if (matchesShortcut(event, settings.shortcuts.openFile) && !event.repeat) {
        event.preventDefault()
        void handleOpenFile()
        return
    }

    if (matchesShortcut(event, settings.shortcuts.toggleSidebar) && !event.repeat) {
        event.preventDefault()
        toggleSidebar()
        return
    }

    if (matchesShortcut(event, settings.shortcuts.toggleSource) && !event.repeat) {
        event.preventDefault()
        void toggleSourceMode()
        return
    }

    // AI Chat 侧栏快捷键
    if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        !event.repeat &&
        event.key.toLowerCase() === 'a'
    ) {
        event.preventDefault()
        if (isDocumentOpen.value) {
            isAiChatOpen.value = !isAiChatOpen.value
        }
        return
    }

    // 查找面板快捷键保持固定，不参与设置页自定义。
    if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        !event.repeat &&
        event.key.toLowerCase() === 'f'
    ) {
        event.preventDefault()
        findReplaceController.open()
        return
    }

    // F3 在未打开时打开并跳到第一个匹配，已打开时继续跳转下一个。
    if (event.key === 'F3') {
        event.preventDefault()
        if (!findReplaceController.isOpen.value) {
            findReplaceController.open()
        } else if (event.shiftKey) {
            findReplaceController.goToPrev()
        } else {
            findReplaceController.goToNext()
        }
    }
}

onMounted(() => {
    window.addEventListener('keydown', handleWindowKeydown, true)
    // 编辑菜单的“查找”入口与 Ctrl+F 快捷键最终都会走到这里。
    documentService.onFindReplace(() => findReplaceController.open())
    // 导出菜单的导出入口统一进入 handleExport，按类型分发。
    documentService.onExportHtml(() => void handleExport('html'))
    documentService.onExportPdf(() => void handleExport('pdf'))
    documentService.onExportZip(() => void handleExport('zip'))
    documentService.onExportText(() => void handleExport('text'))
    documentService.onExportDocx(() => void handleExport('docx'))
    documentService.onExportImage(() => void handleExport('image'))
    // 每次软件启动只自动检测一次；没有新版本时不打断用户。
    void checkForUpdates(false)
    void loadRecentFiles()
})

onUnmounted(() => {
    window.removeEventListener('keydown', handleWindowKeydown, true)
    documentService.removeListeners(IPC_CHANNELS.menuFindReplace)
    documentService.removeListeners(IPC_CHANNELS.menuExportHtml)
    documentService.removeListeners(IPC_CHANNELS.menuExportPdf)
    documentService.removeListeners(IPC_CHANNELS.menuExportZip)
    documentService.removeListeners(IPC_CHANNELS.menuExportText)
    documentService.removeListeners(IPC_CHANNELS.menuExportDocx)
    documentService.removeListeners(IPC_CHANNELS.menuExportImage)
})

const handleScrollToHeading = (headingIndex: number): void => {
    editorRef.value?.scrollToHeading(headingIndex)
}

// 从文档路径提取不带扩展名的文件名，用于导出保存对话框的默认文件名。
const getSuggestedName = (): string => {
    const filePath = currentFilePath.value
    if (!filePath) return '未命名'
    const segments = filePath.split(/[\\/]/)
    const fileName = segments[segments.length - 1] ?? '未命名'
    return fileName.replace(/\.[^.]+$/, '') || '未命名'
}

// 统一导出入口：HTML/PDF/图片先渲染内容，TXT 直接输出原文，ZIP 打包 Markdown 与本地图片。
const handleExport = async (type: 'html' | 'pdf' | 'zip' | 'text' | 'docx' | 'image'): Promise<void> => {
    if (!isDocumentOpen.value) return
    const suggestedName = getSuggestedName()
    try {
        if (type === 'zip') {
            // ZIP 内的 Markdown 文件保留原文件名，未保存的新文档使用 untitled.md。
            const filePath = currentFilePath.value
            const fileName = filePath ? filePath.split(/[\\/]/).pop()! : 'untitled.md'
            const zipData = await buildExportZip(currentContent.value, filePath, fileName)
            await exportService.exportZip(zipData, suggestedName)
            return
        }
        if (type === 'text') {
            await exportService.exportText(buildExportText(currentContent.value), suggestedName)
            return
        }
        if (type === 'docx') {
            const docxData = await buildExportDocx(currentContent.value, currentFilePath.value, suggestedName)
            await exportService.exportDocx(docxData, suggestedName)
            return
        }
        const html = await buildExportHtml(currentContent.value, currentFilePath.value, suggestedName)
        if (type === 'html') await exportService.exportHtml(html, suggestedName)
        else if (type === 'image') await exportService.exportImage(html, suggestedName)
        else await exportService.exportPdf(html, suggestedName)
    } catch (error) {
        await window.electronAPI.showErrorMessage('导出失败', (error as Error).message)
    }
}

// 文档内容或编辑模式变化时，若查找面板打开则重新收集匹配，保证计数与高亮始终准确。
watch([currentContent, isSourceMode], () => findReplaceController.refresh())
</script>
