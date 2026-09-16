<template>
  <NodeViewWrapper
    data-xmd-attachment
    :data-file-name="node.attrs.fileName"
    :data-file-size="node.attrs.fileSize"
    :data-file-type="node.attrs.fileType"
    :data-url="node.attrs.url"
    :title="isMissing ? `文件不存在：${node.attrs.url}` : undefined"
    class="xmd-attachment my-2 flex h-16 w-[400px] max-w-full items-center gap-3 rounded-lg border px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    :class="isMissing ? 'border-line bg-toolbar' : 'border-line bg-paper hover:border-muted hover:bg-toolbar'"
    contenteditable="false"
    tabindex="0"
  >
    <!-- 蓝色文档图标承担主要识别作用，扩展名只作为次级信息展示。 -->
    <span class="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-md"
      :class="isMissing ? 'bg-control text-muted' : 'bg-ink text-inverse'">
      <Icon :icon="isMissing ? 'lucide:alert-triangle' : 'lucide:file-text'" :size="18" />
      <span class="max-w-8 truncate font-mono text-[8px] font-semibold leading-3">
        {{ typeLabel }}
      </span>
    </span>

    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate text-[13px] font-medium leading-5 text-ink">
        {{ node.attrs.fileName }}
      </span>
      <span class="text-[11px] leading-4" :class="isMissing ? 'text-danger' : 'text-muted'">
        {{ isMissing ? '文件已丢失' : sizeLabel }}
      </span>
    </span>

    <span
      v-if="isMissing"
      class="flex h-6 shrink-0 items-center rounded-md border border-danger/30 bg-paper px-2 text-[10px] font-medium text-danger"
    >
      缺失
    </span>

    <!-- 只有右侧按钮负责打开文件，点击卡片其他区域仍可正常选中附件节点。 -->
    <!-- 拦截 mousedown 冒泡：避免 ProseMirror 把整个附件节点设为选中态，
         否则点打开按钮后卡片会套上蓝色选中描边和蓝色边框；
         描边改用 focus-visible，鼠标点击不留框，只有键盘 Tab 聚焦时才显示。 -->
    <button
      v-else
      type="button"
      data-xmd-attachment-open
      class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted hover:bg-control hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      title="使用默认应用打开"
      @mousedown.stop
    >
      <Icon icon="lucide:external-link" :size="15" />
    </button>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/vue-3'
import { mediaService } from '../services/mediaService'
import { formatAttachmentCardSize } from '../extensions/Attachment'

const props = defineProps<NodeViewProps>()
const exists = ref<boolean | null>(null)
const isMissing = computed(() => exists.value === false)

const getCurrentDocumentPath = (): string | null => {
  const options = props.extension.options as { getCurrentDocumentPath?: () => string | null }
  return options.getCurrentDocumentPath?.() ?? null
}

const refreshFileState = async (): Promise<void> => {
  const stat = await mediaService.fileStat(String(props.node.attrs.url), getCurrentDocumentPath())
  exists.value = stat.exists
  // 手写链接没有大小元数据（fileSize 为 0）：文件存在时读磁盘真实大小显示，
  // 并写回节点属性，保存文档时大小会带入链接元数据，下次打开直接有大小。
  if (stat.exists && stat.size > 0 && Number(props.node.attrs.fileSize) <= 0) {
    props.updateAttributes({ fileSize: stat.size })
  }
}

const handleWindowFocus = (): void => {
  void refreshFileState()
}

onMounted(() => {
  void refreshFileState()
  window.addEventListener('focus', handleWindowFocus)
})
onBeforeUnmount(() => window.removeEventListener('focus', handleWindowFocus))
watch(() => props.node.attrs.url, () => void refreshFileState())

const typeLabel = computed(() => {
  const fileType = String(props.node.attrs.fileType ?? '')
  return fileType ? fileType.slice(0, 4).toLocaleUpperCase() : 'FILE'
})

// 视图直接格式化节点中的字节数，避免文件卡片依赖 Electron 文件系统；
// 手写链接转换来的附件没有大小信息（0），显示「未知大小」。
const sizeLabel = computed(() => formatAttachmentCardSize(Number(props.node.attrs.fileSize)))
</script>
