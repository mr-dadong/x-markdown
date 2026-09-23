<template>
  <!-- HTML 块按普通渲染内容展示，不提供任何编辑交互入口。 -->
  <NodeViewWrapper class="relative my-2 flex w-full flex-col" data-xmd-html-view contenteditable="false">
    <iframe v-if="previewDocument" ref="previewFrame" :srcdoc="previewDocument" sandbox="allow-same-origin" data-xmd-html-preview-frame
      tabindex="-1" title="HTML 隔离预览" class="flex w-full border-0 bg-transparent" :style="previewFrameStyle"
      @load="handlePreviewLoad" />
    <div v-else-if="previewError" class="flex min-h-4 w-full items-center text-[12px] text-danger" data-xmd-html-preview-status>
      {{ previewError }}
    </div>
    <div v-else class="flex min-h-4 w-full items-center text-[12px] text-muted" data-xmd-html-preview-status>
      {{ source.trim() ? '正在加载 HTML 预览' : '这段 HTML 没有可见内容' }}
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createResolvedHtmlPreviewDocument } from './htmlPreview'
import { mediaService } from '../../../services/mediaService'

const props = defineProps<NodeViewProps>()

const source = computed(() => String(props.node.attrs.source))
const previewFrame = ref<HTMLIFrameElement | null>(null)
const previewHeight = ref(56)
let previewResizeObserver: ResizeObserver | null = null
// 原始字符串仍单独保存在节点属性中；本地图片读取为 data URL 后再交给隔离 iframe。
const previewDocument = ref('')
const previewError = ref('')
let previewRequestId = 0
const getCurrentDocumentPath = (): string | null => {
  const options = props.extension.options as { getCurrentDocumentPath?: () => string | null }
  return options.getCurrentDocumentPath?.() ?? null
}
const refreshPreviewDocument = async (value: string): Promise<void> => {
  const requestId = ++previewRequestId
  previewDocument.value = ''
  previewError.value = ''
  if (!value.trim()) return
  try {
    const document = await createResolvedHtmlPreviewDocument(
      value,
      url => mediaService.readImage(url, getCurrentDocumentPath()),
    )
    if (requestId === previewRequestId) previewDocument.value = document
  } catch (error) {
    if (requestId !== previewRequestId) return
    previewError.value = `HTML 预览加载失败：${error instanceof Error ? error.message : String(error)}`
  }
}
const previewFrameStyle = computed(() => ({ height: `${previewHeight.value}px` }))

const disconnectPreviewObserver = (): void => {
  previewResizeObserver?.disconnect()
  previewResizeObserver = null
}

const updatePreviewHeight = (): void => {
  const frameDocument = previewFrame.value?.contentDocument
  if (!frameDocument) return
  const bodyHeight = frameDocument.body?.scrollHeight ?? 0
  const documentHeight = frameDocument.documentElement?.scrollHeight ?? 0
  previewHeight.value = Math.max(32, bodyHeight, documentHeight)
}

const handlePreviewLoad = (): void => {
  disconnectPreviewObserver()
  const frameDocument = previewFrame.value?.contentDocument
  if (!frameDocument?.body) return

  updatePreviewHeight()
  // 图片、字体和布局变化后同步调整 iframe 高度，避免预览内部出现滚动条。
  const observer = new ResizeObserver(updatePreviewHeight)
  previewResizeObserver = observer
  observer.observe(frameDocument.body)
  observer.observe(frameDocument.documentElement)
}

watch(source, (value) => {
  previewHeight.value = 56
  disconnectPreviewObserver()
  void refreshPreviewDocument(value)
  void nextTick(updatePreviewHeight)
}, { immediate: true })

onBeforeUnmount(() => {
  disconnectPreviewObserver()
})
</script>
