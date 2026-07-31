<template>
  <div class="flex flex-col">
    <button
      type="button"
      class="relative flex h-9 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md border border-transparent px-2 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-[-1px] focus-visible:outline-accent"
      :class="node.path === currentFilePath
        ? 'bg-selected text-ink'
        : 'bg-transparent text-secondary hover:bg-control-hover hover:text-ink'"
      :title="node.path"
      @click="handleClick"
    >
      <span
        v-if="node.path === currentFilePath"
        class="absolute bottom-2 left-0 top-2 w-0.5 rounded-r bg-accent"
      />
      <span class="flex h-5 w-4 shrink-0 items-center justify-center text-muted">
        <Icon
          v-if="node.isDirectory"
          :icon="node.isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'"
          :size="14"
        />
      </span>
      <span
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded"
        :class="node.isDirectory
          ? 'text-folder'
          : node.path === currentFilePath ? 'text-accent' : 'text-muted'"
      >
        <Icon
          :icon="node.isDirectory
            ? (node.isExpanded ? 'lucide:folder-open' : 'lucide:folder')
            : 'lucide:file-text'"
          :size="16"
        />
      </span>
      <span class="min-w-0 flex-1 truncate text-[13px] font-medium">{{ node.name }}</span>
      <span v-if="node.isLoading" class="shrink-0 font-mono text-[10px] text-muted">读取中</span>
      <span
        v-else-if="!node.isDirectory"
        class="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted"
      >
        {{ fileLabel }}
      </span>
    </button>

    <div v-if="node.isDirectory && node.isExpanded" class="flex flex-col pl-4">
      <FileTreeItem
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :current-file-path="currentFilePath"
        @open-file="emit('open-file', $event)"
        @toggle-folder="emit('toggle-folder', $event)"
      />
      <span
        v-if="!node.isLoading && node.children?.length === 0"
        class="flex h-8 items-center px-8 text-[11px] text-muted"
      >
        没有 Markdown 文件
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'

interface FileTreeNode {
  name: string
  isDirectory: boolean
  path: string
  children?: FileTreeNode[]
  isExpanded?: boolean
  isLoading?: boolean
}

const props = defineProps<{
  node: FileTreeNode
  currentFilePath: string | null
}>()

const emit = defineEmits<{
  'open-file': [filePath: string]
  'toggle-folder': [node: FileTreeNode]
}>()

const fileLabel = computed(() => {
  const extension = props.node.name.split('.').pop()
  return extension && extension !== props.node.name ? extension : 'file'
})

const handleClick = (): void => {
  if (props.node.isDirectory) {
    emit('toggle-folder', props.node)
    return
  }
  emit('open-file', props.node.path)
}
</script>
