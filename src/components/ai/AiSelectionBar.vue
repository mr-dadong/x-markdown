<template>
  <!-- 统一圆角、图标与留白，让工具栏接近 macOS 的紧凑浮动面板。 -->
  <div ref="root" class="relative flex max-w-[calc(100vw-32px)] flex-col rounded-lg border border-line bg-panel p-1 font-sans text-secondary [&_button]:font-sans [&_button]:leading-none [&_input]:font-sans" contenteditable="false" @mousedown.prevent @keydown.esc.stop.prevent="closeMenu">
    <div class="flex items-center gap-0.5 overflow-x-auto">
      <button type="button" title="问问 AI" :class="buttonClass" class="gap-1.5 px-2.5 text-accent" @click="askAi">
        <Icon icon="lucide:sparkles" width="15" height="15" />
        <span class="whitespace-nowrap text-[12px] font-medium">问问 AI</span>
      </button>
      <span class="mx-1 h-4 w-px shrink-0 bg-line" />
      <button type="button" ref="blockTrigger" title="文字类型" :class="[buttonClass, menu === 'block' && activeClass]" class="gap-1 px-2" :aria-expanded="menu === 'block'" @click="menu = menu === 'block' ? null : 'block'">
        <Icon icon="lucide:type" width="16" height="16" />
        <Icon icon="lucide:chevron-down" width="11" height="11" class="text-muted" />
      </button>
      <span class="mx-1 h-4 w-px shrink-0 bg-line" />
      <template v-for="item in marks" :key="item.name">
        <button v-if="item.name === 'code'" type="button" title="超链接" :class="[buttonClass, (editor.isActive('link') || menu === 'link') && activeClass]" :aria-expanded="menu === 'link'" @click="openLink">
          <Icon icon="lucide:link-2" width="16" height="16" />
        </button>
        <button type="button" :title="item.label" :class="[buttonClass, editor.isActive(item.name) && activeClass]" :aria-pressed="editor.isActive(item.name)" :disabled="!editor.can().toggleMark(item.name)" @click="toggleMark(item.name)">
          <span class="flex flex-col items-center gap-0.5">
            <Icon :icon="item.icon" width="16" height="16" />
            <span v-if="item.name === 'highlight'" class="h-0.5 w-3.5 rounded-full bg-amber-400" />
          </span>
        </button>
      </template>
    </div>
    <!-- 下拉面板独立定位，不再撑大工具栏；空间不足时向上展开。 -->
    <div v-if="menu === 'block'" :style="panelStyle" class="absolute z-10 flex w-[196px] flex-col overflow-y-auto rounded-lg border border-line bg-panel p-1">

      <template v-for="(item, index) in blocks" :key="item.id">
        <span v-if="index === 4 || index === 7" class="mx-2 my-1 h-px shrink-0 bg-line" />
        <button type="button" class="flex h-[30px] shrink-0 items-center gap-2 rounded px-2 text-left text-[12px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent" :class="activeBlock === item.id ? activeClass : 'hover:bg-control-hover hover:text-ink'" :aria-pressed="activeBlock === item.id" @click="setBlock(item.id)">
          
          <Icon :icon="item.icon" width="16" height="16" class="shrink-0" />
          <span class="flex-1">{{ item.label }}</span><Icon v-if="activeBlock === item.id" icon="lucide:check" width="13" height="13" />
        </button>
      </template>
    </div>
    <!-- 链接表单保持原操作顺序，用独立输入区和主按钮强调保存动作。 -->
    <form v-if="menu === 'link'" :style="panelStyle" class="absolute z-10 flex w-[288px] flex-col gap-3 rounded-lg border border-line bg-panel p-3" @submit.prevent="saveLink">
      <label for="selection-link" class="text-[12px] font-medium text-ink">链接地址</label>
      <div class="flex items-center gap-2 rounded-lg border border-line bg-paper px-2.5 focus-within:border-accent">
        <Icon icon="lucide:link-2" width="15" height="15" class="shrink-0 text-muted" />
        <input id="selection-link" ref="linkInput" v-model="href" type="text" placeholder="https://example.com" class="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted" @mousedown.stop @input="linkError = ''" />
      </div>
      <p v-if="linkError" class="text-xs text-danger" role="alert">{{ linkError }}</p>
      <div class="flex items-center justify-end gap-2 text-[12px]">
        <button v-if="editor.isActive('link')" type="button" class="mr-auto flex h-7 items-center rounded-md px-1 text-danger hover:bg-control-hover" @click="removeLink">移除链接</button>
        <button type="button" class="flex h-7 items-center justify-center rounded-md border border-line bg-paper px-3 hover:bg-control-hover" @click="closeMenu">取消</button>
        <button type="submit" class="flex h-7 items-center justify-center rounded-md bg-accent px-3 font-medium text-white hover:bg-accent-strong">保存</button>
      </div>
    </form>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import boldIcon from '@iconify-icons/lucide/bold'
import strikeIcon from '@iconify-icons/lucide/strikethrough'
import italicIcon from '@iconify-icons/lucide/italic'
import underlineIcon from '@iconify-icons/lucide/underline'
import codeIcon from '@iconify-icons/lucide/code-2'
import highlightIcon from '@iconify-icons/lucide/highlighter'
import type { Editor } from '@tiptap/vue-3'
import { useAiStatus } from '../../composables/useAiStatus'
import type { AiEditAction } from '../../types/ai'
import { applySelectionBlock, type SelectionBlock } from '../../modules/selectionToolbar'

const props = defineProps<{ editor: Editor }>()
// 保留原事件契约，问问 AI 复用选区上下文入口。
const emit = defineEmits<{ run: [action: AiEditAction]; 'add-to-selection': []; 'open-settings': [] }>()
const { isConfigured } = useAiStatus()
const root = ref<HTMLElement | null>(null)
const blockTrigger = ref<HTMLButtonElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const menu = ref<'block' | 'link' | null>(null)
const href = ref('')
const linkError = ref('')
const linkInput = ref<HTMLInputElement | null>(null)
// 按编辑区域的实际空间展开面板，保持工具栏本身的位置与尺寸不变。
function positionPanel() {
  if (!menu.value || !root.value || !blockTrigger.value) return
  const rect = root.value.getBoundingClientRect()
  const bounds = props.editor.view.dom.closest('.editor-scroll')?.getBoundingClientRect()
  if (!bounds) return
  const width = menu.value === 'block' ? 196 : 288
  const height = menu.value === 'block' ? 300 : 190
  const topEdge = Math.max(8, bounds.top + 8)
  const bottomEdge = Math.min(window.innerHeight - 8, bounds.bottom - 8)
  const below = bottomEdge - rect.bottom - 6
  const above = rect.top - topEdge - 6
  const openBelow = below >= height || below >= above
  const desiredLeft = menu.value === 'block' ? blockTrigger.value.getBoundingClientRect().left : rect.right - width
  const left = Math.max(bounds.left + 8, Math.min(desiredLeft, bounds.right - width - 8))
  panelStyle.value = {
    left: `${left - rect.left}px`,
    top: openBelow ? 'calc(100% + 6px)' : 'auto',
    bottom: openBelow ? 'auto' : 'calc(100% + 6px)',
    maxHeight: `${Math.max(0, openBelow ? below : above)}px`,
    overflowY: 'auto',
  }
}
watch(menu, async () => {
  await nextTick()
  positionPanel()
})
// 同一组按钮使用一致的点击区域，选中态沿用主题强调色。
const buttonClass = 'flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-2 hover:bg-control-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30'
const activeClass = 'bg-selected text-accent'
const marks = [
  { name: 'bold', label: '加粗', icon: boldIcon },
  { name: 'strike', label: '删除线', icon: strikeIcon },
  { name: 'italic', label: '斜体', icon: italicIcon },
  { name: 'underline', label: '下划线', icon: underlineIcon },
  { name: 'code', label: '代码', icon: codeIcon },
  { name: 'highlight', label: '高亮选中', icon: highlightIcon },
]
const blocks: { id: SelectionBlock; label: string; icon: string }[] = [
  { id: 'paragraph', label: '正文', icon: 'lucide:type' },
  { id: 'heading1', label: '一级标题', icon: 'lucide:heading-1' },
  { id: 'heading2', label: '二级标题', icon: 'lucide:heading-2' },
  { id: 'heading3', label: '三级标题', icon: 'lucide:heading-3' },
  { id: 'orderedList', label: '有序列表', icon: 'lucide:list-ordered' },
  { id: 'bulletList', label: '无序列表', icon: 'lucide:list' },
  { id: 'taskList', label: '任务', icon: 'lucide:list-checks' },
  { id: 'codeBlock', label: '代码块', icon: 'lucide:code-2' },
  { id: 'blockquote', label: '引用', icon: 'lucide:quote' },
]
const activeBlock = computed(() => {
  for (const name of ['taskList', 'orderedList', 'bulletList', 'blockquote', 'codeBlock']) {
    if (props.editor.isActive(name)) return name
  }
  for (const level of [1, 2, 3]) {
    if (props.editor.isActive('heading', { level })) return `heading${level}`
  }
  return props.editor.isActive('paragraph') ? 'paragraph' : null
})
// 格式切换保持选区，便于连续叠加多个格式。
function toggleMark(name: string) {
  menu.value = null
  props.editor.chain().focus().toggleMark(name).run()
}
function setBlock(block: SelectionBlock) {
  applySelectionBlock(props.editor, block)
  menu.value = null
}
function askAi() {
  menu.value = null
  if (isConfigured()) emit('add-to-selection')
  else emit('open-settings')
}
async function openLink() {
  if (menu.value === 'link') return closeMenu()
  href.value = props.editor.isActive('link') ? props.editor.getAttributes('link').href : ''
  linkError.value = ''
  menu.value = 'link'
  await nextTick()
  linkInput.value?.focus()
}
function saveLink() {
  const value = href.value.trim()
  // 明确提示无效地址，不自动补全或静默忽略错误。
  if (!value || /^(?:javascript|vbscript|data):/i.test(value.replace(/\s/g, ''))) {
    linkError.value = '请输入有效的链接地址，不支持此协议。'
    return
  }
  if (!props.editor.chain().focus().setLink({ href: value }).run()) {
    linkError.value = '无法设置此链接，请检查地址。'
    return
  }
  menu.value = null
}
function removeLink() {
  props.editor.chain().focus().unsetLink().run()
  menu.value = null
}
function closeMenu() {
  menu.value = null
  props.editor.commands.focus()
}
// 切换选区、点击外部时关闭子菜单，防止下次弹出时残留旧表单。
function resetMenu() { menu.value = null }
function onPointerDown(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) resetMenu()
}
// 只在正文或页面滚动时收起，菜单内部滚动仍可继续选择。
function onScroll(event: Event) {
  if (event.target instanceof Node && root.value?.contains(event.target)) return
  resetMenu()
}
onMounted(() => {
  props.editor.on('selectionUpdate', resetMenu)
  document.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('resize', positionPanel)
  document.addEventListener('scroll', onScroll, true)
})
onBeforeUnmount(() => {
  props.editor.off('selectionUpdate', resetMenu)
  document.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('resize', positionPanel)
  document.removeEventListener('scroll', onScroll, true)
})
</script>


