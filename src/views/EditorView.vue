<template>
    <div class="flex h-screen flex-col overflow-hidden bg-paper text-ink">
        <AppHeader :is-dark-theme="isDarkTheme" :has-update="hasUpdate" @toggle-theme="toggleTheme"
            @open-settings="isSettingsOpen = true" @open-update="openUpdateModal" />

        <div class="flex flex-1 overflow-hidden">
            <Sidebar v-if="isSidebarVisible" :current-file-path="currentFilePath" :content="currentContent"
                @open-file="handleOpenFileFromSidebar" @scroll-to="handleScrollToHeading" />
            <!-- min-w-0 允许编辑区在 flex 布局中正确收缩，避免右侧残留空白。 -->
            <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-paper">
                <DocumentBar v-if="isDocumentOpen" :documents="documents" :active-document-id="activeDocumentId"
                    :get-document-title="getDocumentTitle" @activate="activateDocument" @close="closeDocument"
                    @new-file="handleNewFile" @reorder="reorderDocument"
                    @close-others="closeOtherDocuments" @close-left="closeLeftDocuments"
                    @close-right="closeRightDocuments" @close-all="closeAllDocuments"
                    @close-saved="closeSavedDocuments"
                    @save="saveFile()" @save-as="saveFile(true)" />
                <FindReplacePanel :controller="findReplaceController" />
                <MarkdownEditor v-if="isDocumentOpen" ref="editorRef" :initial-content="currentContent"
                    :current-file-path="currentFilePath" :active="!isSourceMode"
                    v-show="!isSourceMode" @update:content="handleContentUpdate" />
                <MarkdownSourceEditor v-if="isDocumentOpen" v-show="isSourceMode" ref="sourceEditorRef"
                    :content="currentContent"
                    @update:content="handleContentUpdate" />
                <div v-if="!isDocumentOpen"
                    class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center select-none"
                    @dragover.prevent="handleWelcomeDragOver" @drop.prevent="handleWelcomeDrop">
                    <!-- 使用正式应用图标建立品牌识别，按钮内仍保留“新建文档”的功能图标。 -->
                    <img :src="appIcon" alt="XMD" class="h-20 w-20 rounded-[22px]" />
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
                </div>
            </main>
        </div>

        <AppStatusBar :line-count="documentStats.lineCount" :word-count="documentStats.wordCount"
            :character-count="documentStats.characterCount" :is-modified="isModified"
            :sidebar-visible="isSidebarVisible" :source-mode="isSourceMode"
            :document-open="isDocumentOpen" @toggle-sidebar="toggleSidebar" @toggle-source-mode="toggleSourceMode" />
        <SettingsModal v-if="isSettingsOpen" @close="isSettingsOpen = false" />
        <UpdateModal v-if="isUpdateModalOpen" />
        <ConfirmDialog />
    </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import appIcon from '../../build/icons/256x256.png'
import AppHeader from '../components/AppHeader.vue'
import AppStatusBar from '../components/AppStatusBar.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import DocumentBar from '../components/DocumentBar.vue'
import FindReplacePanel from '../components/FindReplacePanel.vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import MarkdownSourceEditor from '../components/MarkdownSourceEditor.vue'
import Sidebar from '../components/Sidebar.vue'
import SettingsModal from '../components/SettingsModal.vue'
import UpdateModal from '../components/UpdateModal.vue'
import { useDocument } from '../composables/useDocument'
import { buildExportHtml, buildExportZip } from '../composables/useExport'
import { useFindReplace } from '../composables/useFindReplace'
import { useSettings } from '../composables/useSettings'
import { useTheme } from '../composables/useTheme'
import { useUpdater } from '../composables/useUpdater'
import { IPC_CHANNELS } from '../constants/ipcChannels'
import { documentService } from '../services/documentService'
import { exportService } from '../services/exportService'
import type { EditorHandle, SourceEditorHandle } from '../types/editor'

const editorRef = ref<EditorHandle | null>(null)
const sourceEditorRef = ref<SourceEditorHandle | null>(null)
const isSidebarVisible = ref(false)
const isSettingsOpen = ref(false)
const { settings } = useSettings()
const isSourceMode = ref(settings.editorMode === 'source')
const documentModes = new Map<number, boolean>()
const { isDarkTheme, toggleTheme } = useTheme()
const { hasUpdate, isUpdateModalOpen, checkForUpdates, openUpdateModal } = useUpdater()

// 查找替换控制器：同时服务所见即所得与源码两种编辑模式。
const findReplaceController = useFindReplace(
    () => editorRef.value?.getEditor() ?? null,
    () => sourceEditorRef.value?.getTextarea() ?? null,
    isSourceMode,
)

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
    saveFile,
} = useDocument()

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
    const scrollProgress = isSourceMode.value
        ? sourceEditorRef.value?.getScrollProgress() ?? 0
        : editorRef.value?.getScrollProgress() ?? 0
    isSourceMode.value = !isSourceMode.value
    if (activeDocumentId.value !== null) {
        documentModes.set(activeDocumentId.value, isSourceMode.value)
    }

    // 等待目标视图完成显示和布局后，再恢复切换前的阅读进度。
    await nextTick()
    if (isSourceMode.value) {
        sourceEditorRef.value?.setScrollProgress(scrollProgress)
    } else {
        editorRef.value?.setScrollProgress(scrollProgress)
    }
}

// 每个文档首次打开都严格采用设置中的默认模式，手动切换只影响当前文档。
watch(activeDocumentId, (documentId) => {
    if (documentId === null) return
    const savedMode = documentModes.get(documentId)
    isSourceMode.value = savedMode ?? settings.editorMode === 'source'
    if (savedMode === undefined) documentModes.set(documentId, isSourceMode.value)
})

// 在窗口范围内监听快捷键，编辑器获得焦点时也可以收缩或展开侧边栏。
const handleWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && isSettingsOpen.value) {
        event.preventDefault()
        isSettingsOpen.value = false
        return
    }

    // 查找面板打开时 Esc 优先关闭查找，回到正常的编辑状态。
    if (event.key === 'Escape' && findReplaceController.isOpen.value) {
        event.preventDefault()
        findReplaceController.close()
        return
    }

    if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key === ','
    ) {
        event.preventDefault()
        isSettingsOpen.value = true
        return
    }

    // Ctrl/Cmd+F 打开查找面板并聚焦输入框；已打开时再次按下用于重新聚焦。
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
        return
    }

    if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.repeat &&
        event.key.toLowerCase() === 'b'
    ) {
        event.preventDefault()
        toggleSidebar()
    }
}

onMounted(() => {
    window.addEventListener('keydown', handleWindowKeydown, true)
    // 编辑菜单的“查找”入口与 Ctrl+F 快捷键最终都会走到这里。
    documentService.onFindReplace(() => findReplaceController.open())
    // 文件菜单的三个导出入口统一进入 handleExport，按类型分发。
    documentService.onExportHtml(() => void handleExport('html'))
    documentService.onExportPdf(() => void handleExport('pdf'))
    documentService.onExportZip(() => void handleExport('zip'))
    // 每次软件启动只自动检测一次；没有新版本时不打断用户。
    void checkForUpdates(false)
})

onUnmounted(() => {
    window.removeEventListener('keydown', handleWindowKeydown, true)
    documentService.removeListeners(IPC_CHANNELS.menuFindReplace)
    documentService.removeListeners(IPC_CHANNELS.menuExportHtml)
    documentService.removeListeners(IPC_CHANNELS.menuExportPdf)
    documentService.removeListeners(IPC_CHANNELS.menuExportZip)
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

// 统一导出入口：HTML/PDF 先渲染自包含 HTML，ZIP 直接打包 Markdown 与本地图片。
const handleExport = async (type: 'html' | 'pdf' | 'zip'): Promise<void> => {
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
        const html = await buildExportHtml(currentContent.value, currentFilePath.value, suggestedName)
        if (type === 'html') await exportService.exportHtml(html, suggestedName)
        else await exportService.exportPdf(html, suggestedName)
    } catch (error) {
        await window.electronAPI.showErrorMessage('导出失败', (error as Error).message)
    }
}

// 文档内容或编辑模式变化时，若查找面板打开则重新收集匹配，保证计数与高亮始终准确。
watch([currentContent, isSourceMode], () => findReplaceController.refresh())
</script>
