<template>
  <aside class="flex h-full w-[292px] shrink-0 flex-col overflow-hidden border-r border-line bg-panel">
    <div class="flex shrink-0 flex-col gap-3 border-b border-line px-4 py-3">
      <div v-if="!currentDir" class="flex items-center">
        <button type="button"
          class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-paper px-2 text-[11px] font-medium text-secondary hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @click="selectWorkspace">
          <Icon icon="lucide:folder-open" :size="14" />
          <span>打开文件夹</span>
        </button>
      </div>

      <div class="flex h-8 items-center rounded-md border border-line/60 bg-paper p-0.5">
        <button v-for="tab in tabs" :key="tab.id" type="button"
          class="flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded text-[12px] font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
          :class="activeTab === tab.id
            ? 'border border-transparent bg-control text-secondary'
            : 'border border-transparent bg-transparent text-muted hover:bg-control/50 hover:text-secondary'" @click="activeTab = tab.id">
          <Icon :icon="tab.icon" :size="14" />
          <span>{{ tab.label }}</span>
        </button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <!-- 文件列表 -->
      <div v-if="activeTab === 'files'" class="flex min-h-0 flex-1 flex-col">
        <div v-if="currentDir" class="flex h-9 shrink-0 items-center justify-between px-4">
          <span class="text-[10px] font-semibold tracking-[0.14em] text-muted">资源</span>
          <span class="font-mono text-[10px] text-muted">
            {{ directoryCount }} 目录 · {{ documentCount }} 文档
          </span>
        </div>

        <div class="file-list flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3"
          @contextmenu.prevent="openWorkspaceMenu">
          <div v-if="!currentDir" class="flex h-full flex-col items-center justify-center gap-2 px-7 text-center">
            <div class="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-paper text-muted">
              <Icon icon="lucide:folder-open" :size="19" />
            </div>
            <p class="text-[13px] font-medium text-secondary">尚未打开项目</p>
            <p class="text-[11px] leading-5 text-muted">选择一个文件夹，在独立工作区中浏览 Markdown 文档。</p>
          </div>

          <div v-else-if="files.length === 0"
            class="flex h-full flex-col items-center justify-center gap-2 px-7 text-center">
            <div class="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-paper text-muted">
              <Icon icon="lucide:folder-x" :size="19" />
            </div>
            <p class="text-[13px] font-medium text-secondary">目录中没有文档</p>
            <p class="text-[11px] leading-5 text-muted">当前仅展示目录与 Markdown 文件。</p>
          </div>

          <div v-else class="flex flex-col gap-0.5">
            <FileTreeItem v-for="file in files" :key="file.path" :node="file" :current-file-path="currentFilePath"
              @open-file="emit('open-file', $event)" @toggle-folder="toggleFolder" @context-menu="openFileTreeMenu" />
          </div>
        </div>
      </div>

      <!-- 大纲列表与文件列表共用同一视觉层级，避免切换时结构跳变。 -->
      <div v-if="activeTab === 'outline'" class="flex min-h-0 flex-1 flex-col">
        <div class="flex h-9 shrink-0 items-center justify-between px-4">
          <span class="text-[10px] font-semibold tracking-[0.14em] text-muted">文档结构</span>
          <span v-if="headings.length" class="font-mono text-[10px] text-muted">
            {{ headings.length }} 节
          </span>
        </div>

        <div class="outline-list flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
          <div v-if="headings.length === 0"
            class="flex h-full flex-col items-center justify-center gap-2 px-7 text-center">
            <div class="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-paper text-muted">
              <Icon icon="lucide:list-tree" :size="19" />
            </div>
            <p class="text-[13px] font-medium text-secondary">还没有文档大纲</p>
            <p class="text-[11px] leading-5 text-muted">添加 Markdown 标题后，可从这里快速跳转。</p>
          </div>

          <div v-else class="flex flex-col gap-0.5">
            <button v-for="heading in headings" :key="heading.id" type="button"
              class="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-transparent py-2 pr-2.5 text-left text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
              :class="`level-${heading.level}`" @click="scrollToHeading(heading.id)">
              <span class="font-mono text-[9px] text-muted">H{{ heading.level }}</span>
              <span class="heading-text min-w-0 flex-1 truncate text-[13px] leading-5">
                {{ heading.text }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </aside>

  <Teleport to="body">
    <div v-if="contextMenu" class="fixed inset-0 z-50 flex" @click="closeFileTreeMenu" @contextmenu.prevent="closeFileTreeMenu">
      <div class="fixed flex w-48 flex-col rounded-md border border-line bg-paper p-1 text-[12px] text-secondary"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }" @click.stop>
        <button v-for="item in contextMenuItems" :key="item.action" type="button"
          class="flex h-8 items-center rounded px-2 text-left hover:bg-control-hover hover:text-ink"
          :class="item.action === 'delete' ? 'text-danger' : ''" @click="runFileTreeAction(item.action)">
          {{ item.label }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import MarkdownIt from 'markdown-it'
import FileTreeItem from './FileTreeItem.vue'
import type { FileItem, Heading, SidebarTab } from '../types'
import { SIDEBAR_CONFIG } from '../constants'
import { getDirectoryName, isMarkdownFile } from '../utils/file'
import { fileSystemService } from '../services/fileSystemService'

const props = defineProps<{
  currentFilePath: string | null
  content: string
}>()

const emit = defineEmits<{
  'open-file': [filePath: string]
  'scroll-to': [headingIndex: number]
}>()

// 默认先展示文档结构，文件入口放在右侧，需要时再切换。
const activeTab = ref<SidebarTab>('outline')
const currentDir = ref<string | null>(null)
const files = ref<FileItem[]>([])
const headings = ref<Heading[]>([])
const contextMenu = ref<{ node: FileItem; x: number; y: number; isRoot: boolean } | null>(null)
let headingParseTimer: ReturnType<typeof setTimeout> | null = null
let workspaceRefreshTimer: ReturnType<typeof setTimeout> | null = null
let stopWorkspaceListener: (() => void) | null = null

const tabs = SIDEBAR_CONFIG.tabs
const inlineMarkdownParser = new MarkdownIt({ html: false, linkify: false, typographer: false })

const getHeadingPlainText = (source: string): string => {
  const inlineToken = inlineMarkdownParser.parseInline(source, {})[0]
  if (!inlineToken?.children) return source.trim()

  // 大纲只展示标题的可见文字，粗体、链接、行内代码等 Markdown 定界符不应出现。
  return inlineToken.children
    .filter((token) => token.type === 'text' || token.type === 'code_inline' || token.type === 'image')
    .map((token) => token.content)
    .join('')
    .trim()
}

// Windows 与 macOS 路径都从最后一个分隔符取项目名。
const projectName = computed(() => getDirectoryName(currentDir.value))
const directoryCount = computed(() => files.value.filter((file) => file.isDirectory).length)
const documentCount = computed(() => files.value.length - directoryCount.value)
type FileTreeAction = 'new-file' | 'new-folder' | 'rename' | 'delete' | 'copy-path' | 'show-entry'
const contextMenuItems = computed<{ action: FileTreeAction; label: string }[]>(() => {
  const createItems = contextMenu.value?.node.isDirectory
    ? [
        { action: 'new-file' as const, label: '新建文件' },
        { action: 'new-folder' as const, label: '新建文件夹' },
      ]
    : []
  const entryItems = contextMenu.value?.isRoot ? [] : [
    { action: 'rename' as const, label: '重命名' },
    { action: 'delete' as const, label: '删除' },
  ]
  return [
    ...createItems,
    ...entryItems,
    { action: 'copy-path', label: '复制路径' },
    { action: 'show-entry', label: '在资源管理器中显示' },
  ]
})

const openFileTreeMenu = (node: FileItem, x: number, y: number): void => {
  // 菜单靠近视口边缘时向内收，保证所有操作都能被点击。
  contextMenu.value = { node, x: Math.min(x, window.innerWidth - 200), y: Math.min(y, window.innerHeight - 210), isRoot: false }
}

const openWorkspaceMenu = (event: MouseEvent): void => {
  if (!currentDir.value) return
  openFileTreeMenu({ name: projectName.value, path: currentDir.value, isDirectory: true }, event.clientX, event.clientY)
  if (contextMenu.value) contextMenu.value.isRoot = true
}

const closeFileTreeMenu = (): void => {
  contextMenu.value = null
}

const runFileTreeAction = async (action: FileTreeAction): Promise<void> => {
  const node = contextMenu.value?.node
  closeFileTreeMenu()
  if (!node) return

  try {
    if (action === 'new-file' || action === 'new-folder') {
      const name = window.prompt(action === 'new-file' ? '请输入文件名' : '请输入文件夹名')
      if (name === null) return
      await fileSystemService.createEntry(node.path, name, action === 'new-folder')
    } else if (action === 'rename') {
      const newName = window.prompt('请输入新名称', node.name)
      if (newName === null || newName === node.name) return
      await fileSystemService.renameEntry(node.path, newName)
    } else if (action === 'delete') {
      if (!window.confirm(`确定删除“${node.name}”吗？${node.isDirectory ? '文件夹内的内容也会一并删除。' : ''}`)) return
      await fileSystemService.deleteEntry(node.path)
    } else if (action === 'copy-path') {
      await fileSystemService.copyPath(node.path)
      return
    } else {
      await fileSystemService.showEntry(node.path)
      return
    }
    await loadFiles()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await window.electronAPI.showErrorMessage('文件操作失败', message)
  }
}

const loadFiles = async (): Promise<void> => {
  if (!currentDir.value) {
    files.value = []
    return
  }

  try {
    const items = await fileSystemService.readDirectory(currentDir.value)
    files.value = items.filter((item) => item.isDirectory || isMarkdownFile(item.name))
  } catch (error) {
    console.error('读取目录失败:', error)
    files.value = []
  }
}

const openWorkspace = async (directoryPath: string): Promise<void> => {
  currentDir.value = directoryPath
  await fileSystemService.watchWorkspace(directoryPath)
  await loadFiles()
}

const selectWorkspace = async (): Promise<void> => {
  const directoryPath = await fileSystemService.selectWorkspace()
  if (directoryPath) await openWorkspace(directoryPath)
}

const scheduleWorkspaceRefresh = (): void => {
  if (workspaceRefreshTimer) clearTimeout(workspaceRefreshTimer)
  workspaceRefreshTimer = setTimeout(() => {
    void loadFiles()
    workspaceRefreshTimer = null
  }, 180)
}

const toggleFolder = async (folder: FileItem): Promise<void> => {
  if (folder.isLoading) return

  if (folder.isExpanded) {
    folder.isExpanded = false
    return
  }

  if (folder.children) {
    folder.isExpanded = true
    return
  }

  folder.isLoading = true
  try {
    const items = await fileSystemService.readDirectory(folder.path)
    // 子目录按需读取，避免打开大型项目时一次遍历整个目录树。
    folder.children = items.filter((item) => item.isDirectory || isMarkdownFile(item.name))
    folder.isExpanded = true
  } catch (error) {
    console.error('读取子目录失败:', error)
  } finally {
    folder.isLoading = false
  }
}

const parseHeadings = (): void => {
  if (!props.content) {
    headings.value = []
    return
  }

  const newHeadings: Heading[] = []
  let codeFence: { marker: string; length: number } | null = null

  props.content.split('\n').forEach((line, lineIndex) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      const length = fenceMatch[1].length

      // 代码块里的“# 注释”不是文档标题，必须排除，否则后续标题会与右侧节点错位。
      if (!codeFence) {
        codeFence = { marker, length }
      } else if (codeFence.marker === marker && length >= codeFence.length) {
        codeFence = null
      }
      return
    }

    if (codeFence) return

    const match = line.match(/^ {0,3}(#{1,6})\s+(.+)$/)
    if (!match) return

    const level = match[1].length
    // ATX 标题末尾允许使用一组 # 作为闭合标记，这组字符也不是标题正文。
    const headingSource = match[2].replace(/\s+#+\s*$/, '').trim()
    const text = getHeadingPlainText(headingSource)
    const index = newHeadings.length
    const id = `heading-${lineIndex}-${text.replace(/\s+/g, '-').toLowerCase()}`
    newHeadings.push({ id, text, level, index })
  })
  headings.value = newHeadings
}

const scrollToHeading = (headingId: string): void => {
  const heading = headings.value.find((item) => item.id === headingId)
  if (heading) emit('scroll-to', heading.index)
}

// 打开文件时先让编辑器完成正文渲染，再生成大纲。
// 连续输入会合并为一次解析，避免每次按键都扫描整篇文档。
const scheduleHeadingParse = (): void => {
  if (headingParseTimer) clearTimeout(headingParseTimer)
  headingParseTimer = setTimeout(() => {
    parseHeadings()
    headingParseTimer = null
  }, 260)
}

watch(
  () => props.content,
  scheduleHeadingParse,
  { immediate: true, flush: 'post' },
)

// 大纲属于“展示时即应正确”的界面：除了内容变化，还要在下面两类时机
// 重新按当前最新正文生成，避免任何一次内容刷新被合并/丢失后大纲残留为空：
// 1) 用户把侧栏切换到大纲标签（面板由隐藏/其他标签变为可见）；
// 2) 切到另一个文档（currentFilePath 变化）——此时即使正文停留为空也按新文档
//    立即重建，内容随后落地时会再触发一次 content 监听做最终校正。
const forceRefreshOutline = (): void => {
  if (activeTab.value !== 'outline') return
  if (headingParseTimer) {
    clearTimeout(headingParseTimer)
    headingParseTimer = null
  }
  parseHeadings()
}

watch(activeTab, (tab) => {
  if (tab === 'outline') forceRefreshOutline()
})

watch(
  () => props.currentFilePath,
  () => {
    // 切换文档后异步读取的内容尚未就绪时就按旧值解析没有意义，
    // 直接强制执行一次并把内容监听作为最终校正，保证始终基于最新原文。
    forceRefreshOutline()
    scheduleHeadingParse()
  },
)

onMounted(async () => {
  stopWorkspaceListener = fileSystemService.onWorkspaceChanged(scheduleWorkspaceRefresh)
  const savedWorkspace = await fileSystemService.getWorkspace()
  if (savedWorkspace) {
    try {
      await openWorkspace(savedWorkspace)
      return
    } catch (error) {
      console.error('恢复工作区失败:', error)
    }
  }
  if (props.currentFilePath) {
    const directoryPath = await fileSystemService.getDirectoryName(props.currentFilePath)
    await openWorkspace(directoryPath)
  }
})

watch(() => props.currentFilePath, async (filePath) => {
  if (currentDir.value || !filePath) return
  const directoryPath = await fileSystemService.getDirectoryName(filePath)
  await openWorkspace(directoryPath)
})

onUnmounted(() => {
  if (headingParseTimer) clearTimeout(headingParseTimer)
  if (workspaceRefreshTimer) clearTimeout(workspaceRefreshTimer)
  stopWorkspaceListener?.()
  void fileSystemService.unwatchWorkspace()
})
</script>

<style scoped>
/* 标题层级仅控制缩进，其他视觉样式全部由 Tailwind 工具类负责。 */
.level-1 {
  @apply pl-2.5;
}

.level-2 {
  @apply pl-5;
}

.level-3 {
  @apply pl-8;
}

.level-4 {
  @apply pl-11;
}

.level-5 {
  @apply pl-14;
}

.level-6 {
  @apply pl-[68px];
}

.level-1 .heading-text,
.level-2 .heading-text {
  @apply font-semibold;
}
</style>
