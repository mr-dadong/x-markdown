<template>
  <!-- HTML 块按普通渲染内容展示，不提供任何编辑交互入口。 -->
  <NodeViewWrapper class="relative my-2 flex w-full flex-col" data-xmd-html-view contenteditable="false">
    <iframe v-if="previewDocument" ref="previewFrame" :srcdoc="previewDocument" sandbox="allow-same-origin" data-xmd-html-preview-frame
      tabindex="-1" :title="t('html.previewTitle')" class="flex w-full border-0 bg-transparent" :style="previewFrameStyle"
      @load="handlePreviewLoad" />
    <div v-else-if="previewError" class="flex min-h-4 w-full items-center text-[12px] text-danger" data-xmd-html-preview-status>
      {{ previewError }}
    </div>
    <div v-else class="flex min-h-4 w-full items-center text-[12px] text-muted" data-xmd-html-preview-status>
      {{ source.trim() ? t('html.loading') : t('html.empty') }}
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { t } from '../../../composables/useI18n'
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createResolvedHtmlPreviewDocument } from './htmlPreview'
import { resolvePreviewHeight } from './htmlPreviewHeight'
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
      // 网络图片由主进程限时下载后转成 data URL，iframe 无需开放网络权限。
      url => mediaService.readImage(url, getCurrentDocumentPath(), true),
    )
    if (requestId === previewRequestId) previewDocument.value = document
  } catch (error) {
    if (requestId !== previewRequestId) return
    previewError.value = t('html.loadFailed', { error: error instanceof Error ? error.message : String(error) })
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
  /*
   * 只取预览正文的高度。documentElement.scrollHeight 至少等于 iframe 自身的视口高度，
   * 算进来会让高度只增不减：加载时宽度偏窄或布局尚未稳定量到的高度，之后即使内容
   * 变矮也缩不回去，表现就是预览块下方一整片空白。
   */
  previewHeight.value = resolvePreviewHeight(frameDocument.body?.scrollHeight ?? 0)
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
