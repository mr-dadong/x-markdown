<template>
  <NodeViewWrapper class="relative flex w-full" :class="hasVisiblePreview ? 'my-4' : 'my-0.5'" data-xmd-html-view>
    <div ref="anchorElement" class="relative flex w-full"
      contenteditable="false" title="双击编辑 HTML 源码" @dblclick.stop="startEditing">
      <!-- 预览只呈现过滤后的 HTML；注释等无可见内容的块只保留一个很小的可选中区域。 -->
      <div v-if="hasVisiblePreview" class="min-w-0 flex-1" v-html="sanitizedHtml" />
      <div v-else class="flex h-1 w-full" />

      <button v-if="props.selected && !editing" type="button" title="编辑 HTML 源码"
        class="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md border border-line bg-paper text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @click.stop="startEditing">
        <Icon icon="lucide:pen-line" :size="14" />
      </button>
    </div>

    <MarkdownModulePopover v-if="editing" title="编辑 HTML" description="更改实时预览，脚本不会执行"
      icon="lucide:code-2" :position="popoverPosition" :width="560" :height="560"
      :fullscreen="fullscreen" fullscreen-enabled submit-label="完成"
      @cancel="cancelEditing" @submit="saveEditing" @toggle-fullscreen="fullscreen = !fullscreen">
      <div class="flex min-h-0 flex-1 flex-col bg-paper">
        <div class="flex h-9 shrink-0 items-center justify-between border-b border-line px-3.5">
          <span class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-secondary">
            <Icon icon="lucide:code-2" :size="13" />
            HTML
          </span>
          <span class="font-mono text-[9px] text-muted">{{ lineNumbers.length }} 行 · UTF-8</span>
        </div>
        <HtmlSourceEditor v-model="draft" @submit="saveEditing" />
      </div>
    </MarkdownModulePopover>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import DOMPurify from 'dompurify'
import { computed, ref, watch } from 'vue'
import HtmlSourceEditor from './HtmlSourceEditor.vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import { getNodeViewPopoverPosition } from '../shared/nodeViewPopover'

const props = defineProps<NodeViewProps>()

const anchorElement = ref<HTMLElement | null>(null)
const popoverPosition = ref<Record<string, string>>({ left: '12px', top: '12px' })
const editing = ref(false)
const fullscreen = ref(false)
const source = computed(() => String(props.node.attrs.source))
const draft = ref(source.value)
const sourceBeforeEditing = ref(source.value)
const lineNumbers = computed(() => Array.from({ length: draft.value.split('\n').length }, (_, index) => index + 1))
// 渲染视图展示安全预览，原始字符串仍单独保存在节点属性中用于无损编辑和保存。
const sanitizedHtml = computed(() => DOMPurify.sanitize(source.value, {
  USE_PROFILES: { html: true },
}))
const hasVisiblePreview = computed(() => sanitizedHtml.value.trim().length > 0)

const startEditing = (): void => {
  if (!anchorElement.value) return
  sourceBeforeEditing.value = source.value
  draft.value = source.value
  popoverPosition.value = getNodeViewPopoverPosition(anchorElement.value, 560, 360)
  fullscreen.value = false
  editing.value = true
}

const cancelEditing = (): void => {
  editing.value = false
  fullscreen.value = false
  // 实时预览期间取消编辑，需要恢复打开弹窗之前的 HTML 源码。
  props.updateAttributes({ source: sourceBeforeEditing.value })
  draft.value = sourceBeforeEditing.value
}

const saveEditing = (): void => {
  editing.value = false
  fullscreen.value = false
}

watch(source, (value) => {
  draft.value = value
})

// HTML 仍经过 DOMPurify 过滤后展示；源码输入则立即同步到当前文档节点。
watch(draft, (value) => {
  if (!editing.value || value === source.value) return
  props.updateAttributes({ source: value })
})
</script>
