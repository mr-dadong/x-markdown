<template>
  <div
    ref="barRef"
    class="relative z-10 flex h-11 shrink-0 items-end gap-1 overflow-x-auto border-b border-line bg-toolbar px-2 pt-1.5 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    @dblclick="handleBarDoubleClick" @dragover.prevent @drop="handleBarDrop" @wheel="handleBarWheel">
    <button v-for="document in documents" :key="document.id" type="button" draggable="true"
      :data-document-id="document.id"
      class="group relative flex h-9 min-w-[150px] max-w-[260px] shrink-0 items-center overflow-hidden rounded-t-md border px-3 text-[13px]"
      :class="[
        document.id === activeDocumentId
          ? 'border-line border-b-paper bg-paper text-ink'
          : 'border-transparent bg-toolbar text-secondary hover:border-line hover:bg-control-hover',
        draggedDocumentId === document.id ? 'opacity-40' : '',
      ]"
      :title="document.filePath ?? getDocumentTitle(document)" @click="emit('activate', document.id)"
      @contextmenu.prevent="openContextMenu($event, document.id)"
      @dragstart="handleDragStart($event, document.id)"
      @dragover.prevent="handleDocumentDragOver($event, document.id)"
      @drop.stop="handleDocumentDrop($event, document.id)" @dragend="handleDragEnd">
      <span v-if="dragOverDocumentId === document.id"
        class="pointer-events-none absolute bottom-1 top-1 w-0.5 rounded bg-accent"
        :class="dragOverPlaceAfter ? 'right-0' : 'left-0'" />
      <Icon icon="lucide:file-text" :size="15" class="mr-2 shrink-0 text-muted" />
      <!-- 标题只能占用图标与关闭按钮之间的空间，过长时在标签内部截断。 -->
      <span class="min-w-0 flex-1 truncate whitespace-nowrap text-left font-medium">{{ getDocumentTitle(document) }}</span>
      <span
        class="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-control-active hover:text-ink"
        title="关闭文档" @click.stop="emit('close', document.id)">
        <span v-if="document.isModified" class="h-1.5 w-1.5 rounded-full bg-accent group-hover:hidden" title="尚未保存" />
        <Icon icon="lucide:x" :size="15" :class="document.isModified ? 'hidden group-hover:block' : 'block'" />
      </span>
    </button>
  </div>

  <Teleport to="body">
    <div v-if="contextMenu" ref="contextMenuRef"
      class="fixed z-[200] flex w-44 flex-col rounded-md border border-line bg-paper p-1 text-[12px] text-ink"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @contextmenu.prevent>
      <button type="button"
        class="flex h-8 items-center gap-2.5 rounded px-2.5 text-left text-accent hover:bg-selected"
        @click="handleSave">
        <Icon icon="lucide:save" :size="14" class="shrink-0" />
        <span class="flex-1">保存</span>
        <span class="text-[10px] text-muted">{{ saveShortcutLabel }}</span>
      </button>
      <button type="button"
        class="flex h-8 items-center gap-2.5 rounded px-2.5 text-left text-accent hover:bg-selected"
        @click="handleSaveAs">
        <Icon icon="lucide:copy-plus" :size="14" class="shrink-0" />
        <span class="flex-1">另存为</span>
        <span class="text-[10px] text-muted">Ctrl+Shift+S</span>
      </button>
      <div class="my-1 flex border-t border-line" />
      <button type="button"
        class="flex h-8 items-center gap-2.5 rounded px-2.5 text-left text-accent hover:bg-selected disabled:text-muted disabled:hover:bg-paper"
        :disabled="!hasFilePath" @click="handleShowInExplorer">
        <Icon icon="lucide:folder-open" :size="14" class="shrink-0" />
        <span class="flex-1">在资源管理器中显示</span>
      </button>
      <div class="my-1 flex border-t border-line" />
      <button type="button"
        class="flex h-8 items-center gap-2.5 rounded px-2.5 text-left hover:bg-control-hover"
        @click="handleCloseCurrent">
        <Icon icon="lucide:x" :size="14" class="shrink-0 text-secondary" />
        <span>关闭当前标签页</span>
      </button>
      <button type="button"
        class="flex h-8 items-center gap-2.5 rounded px-2.5 text-left text-secondary hover:bg-control-hover hover:text-ink disabled:text-muted disabled:hover:bg-paper"
        :disabled="documents.length <= 1" @click="handleCloseOthers">
        <Icon icon="lucide:files" :size="14" class="shrink-0" />
        <span>关闭其他标签页</span>
      </button>
      <button type="button"
        class="flex h-8 items-center gap-2.5 rounded px-2.5 text-left text-secondary hover:bg-control-hover hover:text-ink disabled:text-muted disabled:hover:bg-paper"
        :disabled="!hasLeftDocuments" @click="handleCloseLeft">
        <Icon icon="lucide:panel-left-open" :size="14" class="shrink-0" />
        <span>关闭左侧标签页</span>
      </button>
      <button type="button"
        class="flex h-8 items-center gap-2.5 rounded px-2.5 text-left text-secondary hover:bg-control-hover hover:text-ink disabled:text-muted disabled:hover:bg-paper"
        :disabled="!hasRightDocuments" @click="handleCloseRight">
        <Icon icon="lucide:panel-right-open" :size="14" class="shrink-0" />
        <span>关闭右侧标签页</span>
      </button>
      <button type="button"
        class="flex h-8 items-center gap-2.5 rounded px-2.5 text-left text-accent hover:bg-selected disabled:text-muted disabled:hover:bg-paper"
        :disabled="!hasSavedDocuments" @click="handleCloseSaved">
        <Icon icon="lucide:check" :size="14" class="shrink-0" />
        <span>关闭已保存标签页</span>
      </button>
      <div class="my-1 flex border-t border-line" />
      <button type="button"
        class="flex h-8 items-center gap-2.5 rounded px-2.5 text-left text-danger hover:bg-control-hover"
        @click="handleCloseAll">
        <Icon icon="lucide:trash-2" :size="14" class="shrink-0" />
        <span>关闭所有标签页</span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { OpenDocument } from '../types'
import { useSettings } from '../composables/useSettings'

const { settings } = useSettings()
const saveShortcutLabel = computed(() => settings.shortcuts.saveFile || '—')

const props = defineProps<{
  documents: OpenDocument[]
  activeDocumentId: number | null
  getDocumentTitle: (document: OpenDocument | null) => string
}>()

const emit = defineEmits<{
  activate: [documentId: number]
  close: [documentId: number]
  newFile: []
  reorder: [sourceDocumentId: number, targetDocumentId: number | null, placeAfter: boolean]
  closeOthers: [documentId: number]
  closeLeft: [documentId: number]
  closeRight: [documentId: number]
  closeSaved: []
  closeAll: []
  save: []
  saveAs: []
  showInExplorer: [documentId: number]
}>()

const draggedDocumentId = ref<number | null>(null)
const dragOverDocumentId = ref<number | null>(null)
const dragOverPlaceAfter = ref(false)
const barRef = ref<HTMLElement | null>(null)
const contextMenuRef = ref<HTMLElement | null>(null)
const contextMenu = ref<{ documentId: number; x: number; y: number } | null>(null)
const contextDocumentIndex = computed(() => props.documents.findIndex(
  (document) => document.id === contextMenu.value?.documentId,
))
const hasLeftDocuments = computed(() => contextDocumentIndex.value > 0)
const hasRightDocuments = computed(() => (
  contextDocumentIndex.value >= 0 && contextDocumentIndex.value < props.documents.length - 1
))
const hasSavedDocuments = computed(() => props.documents.some((document) => !document.isModified))
// 未保存的新文档没有磁盘路径，无法在资源管理器中定位。
const contextDocument = computed(() => props.documents.find(
  (document) => document.id === contextMenu.value?.documentId,
) ?? null)
const hasFilePath = computed(() => contextDocument.value?.filePath != null)

watch(
  () => [props.activeDocumentId, props.documents.length] as const,
  async ([documentId]) => {
    if (documentId === null) return

    await nextTick()
    const bar = barRef.value
    const activeTab = bar?.querySelector<HTMLElement>(
      `[data-document-id="${documentId}"]`,
    )
    if (!bar || !activeTab) return

    // 直接比较标签与可视区域的边界，避免浏览器把“只露出图标”误判为已经可见。
    const visibleLeft = bar.scrollLeft
    const visibleRight = visibleLeft + bar.clientWidth
    const tabLeft = activeTab.offsetLeft
    const tabRight = tabLeft + activeTab.offsetWidth

    if (tabRight > visibleRight) {
      bar.scrollLeft = tabRight - bar.clientWidth
    } else if (tabLeft < visibleLeft) {
      bar.scrollLeft = tabLeft
    }
  },
  { flush: 'post' },
)

const handleBarDoubleClick = (event: MouseEvent): void => {
  // 只有事件直接发生在标签栏容器上时才算空白区域，双击标签或关闭按钮不会新建文档。
  if (event.target !== event.currentTarget) return
  emit('newFile')
}

const handleDragStart = (event: DragEvent, documentId: number): void => {
  draggedDocumentId.value = documentId
  if (!event.dataTransfer) return

  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(documentId))
}

const handleDocumentDrop = (event: DragEvent, targetDocumentId: number): void => {
  const sourceDocumentId = draggedDocumentId.value
  if (sourceDocumentId === null || sourceDocumentId === targetDocumentId) return

  emit('reorder', sourceDocumentId, targetDocumentId, dragOverPlaceAfter.value)
  clearDragState()
}

const handleDocumentDragOver = (event: DragEvent, targetDocumentId: number): void => {
  if (draggedDocumentId.value === null || draggedDocumentId.value === targetDocumentId) {
    dragOverDocumentId.value = null
    return
  }

  const target = event.currentTarget as HTMLElement
  const targetBounds = target.getBoundingClientRect()
  dragOverDocumentId.value = targetDocumentId
  // 插入线跟随鼠标所在的半区，拖动过程中即可看清最终位置。
  dragOverPlaceAfter.value = event.clientX >= targetBounds.left + targetBounds.width / 2
}

const handleBarDrop = (event: DragEvent): void => {
  const sourceDocumentId = draggedDocumentId.value
  // 放到标签栏自身的空白区域时，将标签移动到最右侧。
  if (sourceDocumentId === null || event.target !== event.currentTarget) return
  emit('reorder', sourceDocumentId, null, true)
  clearDragState()
}

const clearDragState = (): void => {
  draggedDocumentId.value = null
  dragOverDocumentId.value = null
  dragOverPlaceAfter.value = false
}

const handleDragEnd = clearDragState

const handleBarWheel = (event: WheelEvent): void => {
  const bar = barRef.value
  if (!bar || bar.scrollWidth <= bar.clientWidth) return

  event.preventDefault()
  // 普通鼠标的纵向滚轮也用于横向浏览标签，触控板的横向手势则保持原方向。
  bar.scrollLeft += event.deltaX || event.deltaY
}

const openContextMenu = async (event: MouseEvent, documentId: number): Promise<void> => {
  emit('activate', documentId)
  contextMenu.value = { documentId, x: event.clientX, y: event.clientY }

  await nextTick()
  const menu = contextMenuRef.value
  if (!menu || !contextMenu.value) return

  // 菜单靠近窗口边缘时向内收，确保所有操作始终完整可见。
  contextMenu.value.x = Math.max(4, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 4))
  contextMenu.value.y = Math.max(4, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 4))
}

const closeContextMenu = (): void => {
  contextMenu.value = null
}

const handleCloseCurrent = (): void => {
  if (!contextMenu.value) return
  emit('close', contextMenu.value.documentId)
  closeContextMenu()
}

const handleCloseOthers = (): void => {
  if (!contextMenu.value || props.documents.length <= 1) return
  emit('closeOthers', contextMenu.value.documentId)
  closeContextMenu()
}

const handleCloseLeft = (): void => {
  if (!contextMenu.value || !hasLeftDocuments.value) return
  emit('closeLeft', contextMenu.value.documentId)
  closeContextMenu()
}

const handleCloseRight = (): void => {
  if (!contextMenu.value || !hasRightDocuments.value) return
  emit('closeRight', contextMenu.value.documentId)
  closeContextMenu()
}

const handleCloseSaved = (): void => {
  if (!hasSavedDocuments.value) return
  emit('closeSaved')
  closeContextMenu()
}

const handleSave = (): void => {
  emit('save')
  closeContextMenu()
}

const handleSaveAs = (): void => {
  emit('saveAs')
  closeContextMenu()
}

const handleShowInExplorer = (): void => {
  if (!contextMenu.value || !hasFilePath.value) return
  emit('showInExplorer', contextMenu.value.documentId)
  closeContextMenu()
}

const handleCloseAll = (): void => {
  emit('closeAll')
  closeContextMenu()
}

const handleWindowKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') closeContextMenu()
}

const handleWindowMouseDown = (event: MouseEvent): void => {
  // 点击菜单内部时交给具体菜单项处理，只有点击外部才关闭菜单。
  if (contextMenuRef.value?.contains(event.target as Node)) return
  closeContextMenu()
}

onMounted(() => {
  window.addEventListener('mousedown', handleWindowMouseDown)
  window.addEventListener('blur', closeContextMenu)
  window.addEventListener('keydown', handleWindowKeydown)
  window.addEventListener('resize', closeContextMenu)
})

onUnmounted(() => {
  window.removeEventListener('mousedown', handleWindowMouseDown)
  window.removeEventListener('blur', closeContextMenu)
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('resize', closeContextMenu)
})
</script>
