<template>
  <NodeViewWrapper class="relative flex w-full flex-col" :class="hasVisiblePreview ? 'my-4' : 'my-0.5'" data-xmd-html-view>
    <div class="relative flex w-full cursor-text"
      contenteditable="false" title="点击编辑 HTML 源码" @click.stop="startEditing">
      <!-- 预览只呈现过滤后的 HTML；注释等无可见内容的块只保留一个很小的可选中区域。 -->
      <div v-if="hasVisiblePreview" class="min-w-0 flex-1" v-html="sanitizedHtml" />
      <div v-else class="flex h-1 w-full" />

    </div>

    <MarkdownModulePopover v-if="editing" :width="560" full-width @cancel="cancelEditing" @submit="saveEditing">
      <div class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#3d3f45] bg-[#1e1f22]">
        <div class="flex h-9 shrink-0 items-center justify-between border-b border-[#3d3f45] bg-[#292a2e] px-3">
          <span class="flex items-center gap-3">
            <span class="flex items-center gap-1.5">
              <span class="flex h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span class="flex h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span class="flex h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </span>
            <span class="font-mono text-[10px] font-medium uppercase tracking-wider text-[#bec1c7]">HTML</span>
          </span>
          <button type="button" :title="lineWrapping ? '关闭自动换行' : '开启自动换行'"
            class="flex h-6 items-center justify-center gap-1 rounded px-2 font-mono text-[10px] text-[#969aa3] hover:bg-[#3a3b40] hover:text-[#e4e6eb]"
            :class="lineWrapping ? 'bg-[#45464c] text-[#e4e6eb]' : ''" @mousedown.prevent="lineWrapping = !lineWrapping">
            <Icon icon="lucide:wrap-text" :size="13" />
            <span>换行</span>
          </button>
        </div>
        <HtmlSourceEditor v-model="draft" :line-wrapping="lineWrapping" :style="sourceEditorStyle" @submit="saveEditing" />
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

const props = defineProps<NodeViewProps>()

const editing = ref(false)
const lineWrapping = ref(false)
const source = computed(() => String(props.node.attrs.source))
const draft = ref(source.value)
const sourceBeforeEditing = ref(source.value)
const lineNumbers = computed(() => Array.from({ length: draft.value.split('\n').length }, (_, index) => index + 1))
// 少量源码按实际行数收紧高度，较长源码达到上限后在窗口内部滚动。
const sourceEditorStyle = computed(() => ({
  height: `${Math.min(280, Math.max(96, lineNumbers.value.length * 20 + 24))}px`,
}))
// 渲染视图展示安全预览，原始字符串仍单独保存在节点属性中用于无损编辑和保存。
const sanitizedHtml = computed(() => DOMPurify.sanitize(source.value, {
  USE_PROFILES: { html: true },
}))
const hasVisiblePreview = computed(() => sanitizedHtml.value.trim().length > 0)

const startEditing = (): void => {
  if (editing.value) return
  sourceBeforeEditing.value = source.value
  draft.value = source.value
  editing.value = true
}

const cancelEditing = (): void => {
  editing.value = false
  // 实时预览期间取消编辑，需要恢复打开弹窗之前的 HTML 源码。
  props.updateAttributes({ source: sourceBeforeEditing.value })
  draft.value = sourceBeforeEditing.value
}

const saveEditing = (): void => {
  editing.value = false
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
