<template>
  <aside class="flex h-full w-[292px] shrink-0 flex-col overflow-hidden border-r border-line bg-panel">
    <!-- 项目铭牌让用户先确认当前目录，再进入文件或大纲。 -->
    <div class="flex shrink-0 flex-col gap-3 border-b border-line px-4 pb-4 pt-5">
      <div class="flex min-w-0 items-center gap-3">
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-paper text-secondary">
          <Icon icon="lucide:braces" :size="18" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-[10px] font-semibold tracking-[0.16em] text-muted">当前项目</span>
          <strong class="truncate text-[14px] font-semibold text-ink" :title="currentDir ?? undefined">
            {{ projectName }}
          </strong>
        </div>
        <div v-if="currentDir"
          class="flex shrink-0 items-center rounded border border-line bg-toolbar px-1.5 py-1 font-mono text-[10px] text-muted">
          {{ files.length }}
        </div>
      </div>

      <div class="flex items-center">
        <button type="button"
          class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-paper px-2 text-[11px] font-medium text-secondary hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @click="selectWorkspace">
          <Icon icon="lucide:folder-open" :size="14" />
          <span>{{ currentDir ? '更换文件夹' : '打开文件夹' }}</span>
        </button>
      </div>

      <div class="flex h-8 items-center rounded-md bg-toolbar p-0.5">
        <button v-for="tab in tabs" :key="tab.id" type="button"
          class="flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded text-[12px] font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
          :class="activeTab === tab.id
            ? 'border border-line bg-paper text-ink'
            : 'border border-transparent bg-transparent text-muted hover:text-ink'" @click="activeTab = tab.id">
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

        <div class="file-list flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
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
              @open-file="emit('open-file', $event)" @toggle-folder="toggleFolder" />
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
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
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

const activeTab = ref<SidebarTab>('files')
const currentDir = ref<string | null>(null)
const files = ref<FileItem[]>([])
const headings = ref<Heading[]>([])
let headingParseTimer: ReturnType<typeof setTimeout> | null = null
let workspaceRefreshTimer: ReturnType<typeof setTimeout> | null = null
let stopWorkspaceListener: (() => void) | null = null

const tabs = SIDEBAR_CONFIG.tabs

// Windows 与 macOS 路径都从最后一个分隔符取项目名。
const projectName = computed(() => getDirectoryName(currentDir.value))
const directoryCount = computed(() => files.value.filter((file) => file.isDirectory).length)
const documentCount = computed(() => files.value.length - directoryCount.value)

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
    const text = match[2].trim()
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
watch(
  () => props.content,
  () => {
    if (headingParseTimer) clearTimeout(headingParseTimer)
    headingParseTimer = setTimeout(() => {
      parseHeadings()
      headingParseTimer = null
    }, 150)
  },
  { immediate: true, flush: 'post' },
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
