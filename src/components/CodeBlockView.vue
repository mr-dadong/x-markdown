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
          class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent group-hover:opacity-100"
          :class="[activeCodeBlockStyle.headerHoverClass, settings.codeWrap ? activeCodeBlockStyle.menuSelectedClass : activeCodeBlockStyle.headerControlClass]"
          @click.stop="settings.codeWrap = !settings.codeWrap">
          <Icon icon="lucide:wrap-text" :size="14" />
        </button>
        <button type="button" :title="copied ? '已复制' : '复制代码'"
          class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent group-hover:opacity-100"
          :class="[activeCodeBlockStyle.headerControlClass, activeCodeBlockStyle.headerHoverClass]"
          @click.stop="copyCode">
          <Icon :icon="copied ? 'lucide:check' : 'lucide:copy'" :size="14" />
        </button>
        <!-- 下载图片按钮：把当前代码块连同配色、语法高亮保存为 PNG 图片。
             导出过程中按钮禁用，鼠标指针改为禁用样式，避免重复触发。 -->
        <button type="button" title="下载为图片" :disabled="exportingImage"
          class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-not-allowed group-hover:opacity-100"
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

    <!-- 导出进度面板用 Teleport 挂到 body：
         面板不属于代码块内容，留在组件里会被截图克隆带进图片，
         也避免编辑器把它当成正文节点、或被祖先元素的 transform 影响定位。 -->
    <Teleport to="body">
      <ExportProgress :visible="exportingImage" format-label="PNG 图片" :message="imageExportMessage"
        :progress="imageExportPercent" />
    </Teleport>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import type { NodeViewProps } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, nextTick, ref } from 'vue'
import CodeLanguagePicker from './code-block/CodeLanguagePicker.vue'
import ExportProgress from './ExportProgress.vue'
import { useSettings } from '../composables/useSettings'
import { exportService } from '../services/exportService'
import { codeBlockToPngSlices } from '../utils/codeBlockImage'
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
   * v3 起 getPos() 的返回类型允许 undefined（节点已不在文档中），此时没有可设置的选区。
   */
  if (typeof codeBlockPosition === "number") {
    props.editor.commands.setTextSelection(codeBlockPosition + 1)
  }

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
// 避免同时产生多个屏幕外克隆容器与保存对话框；同时驱动导出进度面板。
const exportingImage = ref(false)
// 导出进度文案与百分比，阶段与文档导出保持一致（准备 / 生成 / 写入 / 完成）。
const imageExportMessage = ref('正在准备导出')
const imageExportPercent = ref(0)

/*
 * 把当前代码块导出为 PNG 图片，顺序是「先选路径，再生成，最后写盘」：
 * 图片生成随代码块长度增长（几千行时代价明显），放在保存对话框之前会让
 * 点击按钮后先卡住几秒才弹窗；改成先弹对话框，用户操作与生成互不阻塞。
 * 代码块过长时会切成多张图片，生成进度按张数上报，界面不会长时间毫无动静。
 */
const downloadAsImage = async (): Promise<void> => {
  if (exportingImage.value) return
  const root = codeBlockWrapper.value?.$el as HTMLElement | null
  if (!root) return
  // 语言标签可能含路径分隔符（如 xml 的 "HTML / XML"），先替换成连字符，
  // 避免拼出会被当成目录解析的默认文件名。
  const languageLabel = getCodeBlockLanguageLabel(currentLanguage.value).replace(/[\\/]/g, '-')
  exportingImage.value = true
  imageExportPercent.value = 5
  imageExportMessage.value = '请选择保存位置'
  try {
    const filePath = await exportService.choosePngSavePath(`代码块-${languageLabel}`)
    // 用户在保存对话框里取消：直接结束，不生成图片。
    if (!filePath) return
    imageExportPercent.value = 20
    imageExportMessage.value = '正在生成图片'
    // 让进度面板先绘制出来，再开始同步占用主线程的克隆与栅格化。
    await nextTick()
    const slices = await codeBlockToPngSlices(root, settings.codeWrap, (progress) => {
      imageExportPercent.value = 20 + Math.round((progress.completed / progress.total) * 60)
      imageExportMessage.value = progress.total > 1
        ? `正在生成图片 ${progress.completed}/${progress.total}`
        : '正在生成图片'
    })
    imageExportPercent.value = 90
    imageExportMessage.value = slices.length > 1 ? `正在写入 ${slices.length} 张图片` : '正在写入文件'
    await exportService.writePngFiles(filePath, slices)
    imageExportPercent.value = 100
    imageExportMessage.value = slices.length > 1 ? `已导出 ${slices.length} 张图片` : '导出完成'
    // 短暂保留完成状态，让用户明确看到导出已成功。
    await new Promise((resolve) => setTimeout(resolve, 450))
  } catch (error) {
    await window.electronAPI.showErrorMessage('导出图片失败', (error as Error).message)
  } finally {
    exportingImage.value = false
  }
}
</script>
