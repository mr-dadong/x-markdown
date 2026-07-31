<template>
  <NodeViewWrapper
    data-xmd-attachment
    :data-file-name="node.attrs.fileName"
    :data-file-size="node.attrs.fileSize"
    :data-file-type="node.attrs.fileType"
    :data-url="node.attrs.url"
    class="xmd-attachment my-2 flex h-16 w-[400px] max-w-full items-center gap-3 rounded-lg border border-line bg-paper px-3 text-left hover:border-muted hover:bg-toolbar focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent"
    contenteditable="false"
    tabindex="0"
  >
    <!-- 蓝色文档图标承担主要识别作用，扩展名只作为次级信息展示。 -->
    <span class="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md bg-ink text-inverse">
      <Icon icon="lucide:file-text" :size="18" />
      <span class="max-w-8 truncate font-mono text-[8px] font-semibold leading-3">
        {{ typeLabel }}
      </span>
    </span>

    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate text-[13px] font-medium leading-5 text-ink">
        {{ node.attrs.fileName }}
      </span>
      <span class="text-[11px] leading-4 text-muted">
        {{ sizeLabel }}
      </span>
    </span>

    <!-- 只有右侧按钮负责打开文件，点击卡片其他区域仍可正常选中附件节点。 -->
    <button
      type="button"
      data-xmd-attachment-open
      class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted hover:bg-control hover:text-ink focus:outline focus:outline-2 focus:outline-accent"
      title="使用默认应用打开"
    >
      <Icon icon="lucide:external-link" :size="15" />
    </button>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3'

const props = defineProps<NodeViewProps>()

const typeLabel = computed(() => {
  const fileType = String(props.node.attrs.fileType ?? '')
  return fileType ? fileType.slice(0, 4).toLocaleUpperCase() : 'FILE'
})

// 视图直接格式化节点中的字节数，避免文件卡片依赖 Electron 文件系统。
const sizeLabel = computed(() => {
  const bytes = Number(props.node.attrs.fileSize)
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
})
</script>
