<template>
  <node-view-wrapper
    class="code-block-editor group relative my-[0.8em] flex flex-col"
    :class="activeCodeBlockStyle.tokenClass"
    @mouseleave="copied = false"
  >
    <!-- 使用独立标题栏模拟 macOS 代码窗口，所有控件都不会写入 Markdown 正文。 -->
    <div
      contenteditable="false"
      class="flex h-10 items-center justify-between rounded-t-md border border-b-0 px-3"
      :class="activeCodeBlockStyle.headerClass"
    >
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex shrink-0 items-center gap-1.5" title="代码块">
          <span class="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span class="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span class="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>

        <!-- 语言选择器独立维护，便于新增语言或调整交互。 -->
        <CodeLanguagePicker
          :model-value="currentLanguage"
          :style="activeCodeBlockStyle"
          @update:model-value="selectLanguage"
        />
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <!-- 明确提示代码块退出方式，避免后续正文继续落在当前语言块内。 -->
        <span class="hidden items-center gap-1 font-mono text-[9px] text-[#777b83] group-hover:flex dark:text-[#8f949e]">
          <kbd class="flex h-5 items-center rounded border border-[#d0d0d0] px-1.5 dark:border-[#4b4e55]">Ctrl ↵</kbd>
          <span>结束代码块</span>
        </span>
        <button
          type="button"
          :title="copied ? '已复制' : '复制代码'"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent group-hover:opacity-100"
          :class="[activeCodeBlockStyle.headerControlClass, activeCodeBlockStyle.headerHoverClass]"
          @click.stop="copyCode"
        >
          <Icon :icon="copied ? 'lucide:check' : 'lucide:copy'" :size="14" />
        </button>
      </div>
    </div>

    <pre class="!m-0 flex !rounded-b-md !rounded-t-none !px-4 !py-4" :class="activeCodeBlockStyle.preClass"><span
      v-if="settings.codeLineNumbers"
      contenteditable="false"
      class="mr-4 flex shrink-0 select-none flex-col border-r border-current pr-3 text-right opacity-60"
      :class="activeCodeBlockStyle.codeClass"
    ><span v-for="lineNumber in lineNumbers" :key="lineNumber">{{ lineNumber }}</span></span><node-view-content
      as="code"
      class="min-w-0 flex-1"
      :class="activeCodeBlockStyle.codeClass"
    /></pre>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, ref } from 'vue'
import CodeLanguagePicker from './code-block/CodeLanguagePicker.vue'
import { useSettings } from '../composables/useSettings'
import { DEFAULT_CODE_BLOCK_LANGUAGE } from '../modules/codeBlockLanguages'
import { getCodeBlockStyle } from '../modules/codeBlockStyles'

const props = defineProps<NodeViewProps>()
const { settings } = useSettings()
const activeCodeBlockStyle = computed(() => getCodeBlockStyle(settings.codeBlockStyle))
// 代码正文仍由 TipTap 管理，行号单独渲染，避免编号被保存进 Markdown。
const lineNumbers = computed(() => Array.from(
  { length: props.node.textContent.split('\n').length },
  (_, index) => index + 1,
))

const copied = ref(false)
const currentLanguage = computed(() => String(props.node.attrs.language ?? DEFAULT_CODE_BLOCK_LANGUAGE))

const selectLanguage = (language: string): void => {
  const previousSelection = props.editor.state.selection.toJSON()
  const codeBlockPosition = props.getPos()

  /*
   * 当前 TipTap 版本只会重新高亮选区所在的代码块。
   * 先把选区临时放入当前代码块，更新语言后再恢复，避免用户原来的光标位置发生变化。
   */
  props.editor.commands.setTextSelection(codeBlockPosition + 1)

  props.updateAttributes({ language })

  const restoredSelection = Selection.fromJSON(props.editor.state.doc, previousSelection)
  props.editor.view.dispatch(props.editor.state.tr.setSelection(restoredSelection))
}

const copyCode = async (): Promise<void> => {
  await navigator.clipboard.writeText(props.node.textContent)
  copied.value = true
}
</script>
