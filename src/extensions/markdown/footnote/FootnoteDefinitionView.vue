<template>
  <NodeViewWrapper class="relative my-3 flex w-full flex-col border-t border-line pt-2" data-xmd-footnote-view>
    <div class="flex min-h-7 w-full cursor-text items-start gap-2" contenteditable="false"
      title="点击编辑脚注" @click.stop="startEditing">
      <span class="mt-0.5 shrink-0 font-mono text-[10px] font-semibold text-muted">{{ identifier }}</span>
      <div class="min-w-0 flex-1 text-[13px] leading-5 text-secondary [&_ol]:m-0 [&_ol]:pl-5 [&_p]:m-0 [&_p]:text-[13px] [&_ul]:m-0 [&_ul]:pl-5"
        v-html="renderedBody" />
    </div>

    <MarkdownModulePopover v-if="editing" :width="380" full-width @cancel="cancelEditing" @submit="saveEditing">
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
import { computed, ref, watch } from 'vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import { renderSafeMarkdown } from '../shared/safeMarkdown'

const props = defineProps<NodeViewProps>()

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
  if (editing.value) return
  draftIdentifier.value = String(props.node.attrs.identifier)
  draftBody.value = String(props.node.attrs.body)
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
