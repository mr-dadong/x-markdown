<template>
  <NodeViewWrapper class="relative my-3 flex w-full border-t border-line pt-2" data-xmd-footnote-view>
    <div ref="anchorElement" class="flex min-h-7 w-full items-start gap-2" contenteditable="false"
      title="双击编辑脚注" @dblclick.stop="startEditing">
      <span class="mt-0.5 shrink-0 font-mono text-[10px] font-semibold text-muted">{{ identifier }}</span>
      <div class="min-w-0 flex-1 text-[13px] leading-5 text-secondary [&_ol]:m-0 [&_ol]:pl-5 [&_p]:m-0 [&_p]:text-[13px] [&_ul]:m-0 [&_ul]:pl-5"
        v-html="renderedBody" />
      <button v-if="props.selected && !editing" type="button" title="编辑脚注"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @click.stop="startEditing">
        <Icon icon="lucide:pen-line" :size="14" />
      </button>
    </div>

    <MarkdownModulePopover v-if="editing" title="编辑脚注" icon="lucide:file-text" :position="popoverPosition"
      :width="380" @cancel="cancelEditing" @submit="saveEditing">
      <label class="flex h-9 items-center gap-2 px-2.5 focus-within:bg-paper">
        <span class="w-12 shrink-0 text-[11px] text-muted">标识</span>
        <input v-model="draftIdentifier" type="text"
          class="h-full min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-muted/50">
      </label>
      <span class="mx-2.5 h-px bg-line" />
      <label class="flex min-h-24 items-start gap-2 px-2.5 py-2 focus-within:bg-paper">
        <span class="w-12 shrink-0 pt-1 text-[11px] text-muted">内容</span>
        <textarea v-model="draftBody" rows="4" spellcheck="false"
          class="min-h-20 min-w-0 flex-1 resize-none bg-transparent text-[12px] leading-5 text-ink outline-none placeholder:text-muted/50"
          @keydown.stop />
      </label>
    </MarkdownModulePopover>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, ref, watch } from 'vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import { getNodeViewPopoverPosition } from '../shared/nodeViewPopover'
import { renderSafeMarkdown } from '../shared/safeMarkdown'

const props = defineProps<NodeViewProps>()

const anchorElement = ref<HTMLElement | null>(null)
const popoverPosition = ref<Record<string, string>>({ left: '12px', top: '12px' })
const editing = ref(false)
const draftIdentifier = ref(String(props.node.attrs.identifier))
const draftBody = ref(String(props.node.attrs.body))
const identifier = computed(() => String(props.node.attrs.identifier))
const renderedBody = computed(() => renderSafeMarkdown(String(props.node.attrs.body)))

const saveDraft = (): void => {
  props.updateAttributes({
    identifier: draftIdentifier.value.trim(),
    body: draftBody.value.trimEnd(),
  })
}

const startEditing = (): void => {
  if (!anchorElement.value) return
  popoverPosition.value = getNodeViewPopoverPosition(anchorElement.value, 380, 210)
  editing.value = true
}

const cancelEditing = (): void => {
  draftIdentifier.value = String(props.node.attrs.identifier)
  draftBody.value = String(props.node.attrs.body)
  editing.value = false
}

const saveEditing = (): void => {
  saveDraft()
  editing.value = false
}

watch(
  () => props.node.attrs,
  (attributes) => {
    draftIdentifier.value = String(attributes.identifier)
    draftBody.value = String(attributes.body)
  },
)
</script>
