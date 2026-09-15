<template>
  <node-view-wrapper ref="codeBlockWrapper" class="code-block-editor group relative my-[0.8em] flex flex-col"
    :class="activeCodeBlockStyle.tokenClass" @mouseleave="copied = false">
    <!-- 使用独立标题栏模拟 macOS 代码窗口，所有控件都不会写入 Markdown 正文。
         导出图片时根据 data-xmd-code-header 标记整体移除，只保留纯代码内容。 -->
    <div contenteditable="false" data-xmd-code-header
      class="flex h-10 items-center justify-between rounded-t-md border border-b-0 px-3"
      :class="activeCodeBlockStyle.headerClass">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex shrink-0 items-center gap-1.5" title="代码块">
          <span class="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span class="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span class="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>

        <!-- 语言选择器独立维护，便于新增语言或调整交互。 -->
        <CodeLanguagePicker :model-value="currentLanguage" :style="activeCodeBlockStyle"
          @update:model-value="selectLanguage" />
      </div>

      <!-- 操作按钮只服务于编辑交互；按钮区位于标题栏内部，导出图片时随标题栏（data-xmd-code-header）一起移除。 -->
      <div class="flex shrink-0 items-center gap-2">
        <!-- 换行切换按钮：与设置面板的“代码块内自动换行”共用同一个开关，
             开启时用选中底色高亮，方便一眼看出当前状态。 -->
        <button type="button" :title="settings.codeWrap ? '关闭自动换行' : '开启自动换行'"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent group-hover:opacity-100"
          :class="[activeCodeBlockStyle.headerHoverClass, settings.codeWrap ? activeCodeBlockStyle.menuSelectedClass : activeCodeBlockStyle.headerControlClass]"
          @click.stop="settings.codeWrap = !settings.codeWrap">
          <Icon icon="lucide:wrap-text" :size="14" />
        </button>
        <button type="button" :title="copied ? '已复制' : '复制代码'"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent group-hover:opacity-100"
          :class="[activeCodeBlockStyle.headerControlClass, activeCodeBlockStyle.headerHoverClass]"
          @click.stop="copyCode">
          <Icon :icon="copied ? 'lucide:check' : 'lucide:copy'" :size="14" />
        </button>
        <!-- 下载图片按钮：把当前代码块连同配色、语法高亮保存为 PNG 图片。 -->
        <button type="button" title="下载为图片" :disabled="exportingImage"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent group-hover:opacity-100"
          :class="[activeCodeBlockStyle.headerControlClass, activeCodeBlockStyle.headerHoverClass]"
          @click.stop="downloadAsImage">
          <Icon icon="lucide:image-down" :size="14" />
        </button>
      </div>
    </div>

    <!-- 换行开启时文字折行显示；关闭时保留完整行并横向滚动。
         折行后行号与代码行不再逐行对应，此时隐藏行号列避免错位。 -->
    <pre class="!m-0 flex !rounded-b-md !rounded-t-none !px-4 !py-4"
      :class="[activeCodeBlockStyle.preClass, settings.codeWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto']"><span
      v-if="settings.codeLineNumbers && !settings.codeWrap"
      contenteditable="false"
      class="mr-4 flex shrink-0 select-none flex-col border-r border-current pr-3 text-right opacity-60"
      :class="activeCodeBlockStyle.codeClass"
    ><span v-for="lineNumber in lineNumbers" :key="lineNumber" class="leading-[1.5] min-h-[1.5em]">{{ lineNumber }}</span></span><node-view-content
      as="code"
      class="min-w-0 flex-1"
      :class="activeCodeBlockStyle.codeClass"
    /></pre>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import type { NodeViewProps } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, ref } from 'vue'
import CodeLanguagePicker from './code-block/CodeLanguagePicker.vue'
import { useSettings } from '../composables/useSettings'
import { exportService } from '../services/exportService'
import { codeBlockToPngBytes } from '../utils/codeBlockImage'
import { DEFAULT_CODE_BLOCK_LANGUAGE, getCodeBlockLanguageLabel } from '../modules/codeBlockLanguages'
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

// NodeViewWrapper 渲染为单个根元素，通过组件实例的 $el 拿到代码块根 DOM。
const codeBlockWrapper = ref<ComponentPublicInstance | null>(null)

// 导出进行中标志：截图与保存对话框未结束时忽略重复点击，
// 避免同时产生多个屏幕外克隆容器与保存对话框。
const exportingImage = ref(false)

/*
 * 把当前代码块导出为 PNG 图片：
 * 用 html-to-image 在渲染进程内直接克隆截图，语法高亮配色与所选外观
 * 原样保留，图片尺寸就是代码块内容尺寸；生成二进制后交给主进程弹窗保存。
 */
const downloadAsImage = async (): Promise<void> => {
  if (exportingImage.value) return
  const root = codeBlockWrapper.value?.$el as HTMLElement | null
  if (!root) return
  exportingImage.value = true
  try {
    const bytes = await codeBlockToPngBytes(root, settings.codeWrap)
    // 语言标签可能含路径分隔符（如 xml 的 "HTML / XML"），先替换成连字符，
    // 避免拼出会被当成目录解析的默认文件名。
    const languageLabel = getCodeBlockLanguageLabel(currentLanguage.value).replace(/[\\/]/g, '-')
    await exportService.exportPng(bytes, `代码块-${languageLabel}`)
  } catch (error) {
    await window.electronAPI.showErrorMessage('导出图片失败', (error as Error).message)
  } finally {
    exportingImage.value = false
  }
}
</script>
