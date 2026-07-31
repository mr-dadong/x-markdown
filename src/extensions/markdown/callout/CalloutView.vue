<template>
  <NodeViewWrapper class="relative my-[0.8em] flex w-full" data-xmd-callout-view>
    <div
      ref="anchorElement"
      class="relative flex w-full items-start gap-3 rounded-lg border px-4 py-3"
      :class="[typeStyle.surface, props.selected ? 'outline outline-1 outline-accent/30' : '']"
      contenteditable="false"
      title="双击编辑提示块"
      @dblclick.stop="startEditing"
    >
      <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" :class="typeStyle.iconSurface">
        <Icon :icon="typeIcon" :size="16" :class="typeStyle.icon" />
      </div>

      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="flex min-h-8 min-w-0 items-center justify-between gap-3">
          <span class="min-w-0 truncate text-[13px] font-semibold leading-5 text-ink">{{ displayTitle }}</span>

          <div class="flex shrink-0 items-center gap-1">
            <button
              v-if="foldable"
              type="button"
              :title="collapsed ? '展开提示块' : '折叠提示块'"
              class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              @click.stop="collapsed = !collapsed"
            >
              <Icon :icon="collapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'" :size="14" />
            </button>
            <button
              v-if="props.selected && !editing"
              type="button"
              title="编辑提示块"
              class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              @click.stop="startEditing"
            >
              <Icon icon="lucide:pen-line" :size="14" />
            </button>
          </div>
        </div>

        <div
          v-if="!collapsed && hasBody"
          class="text-[14px] leading-6 text-secondary [&_a]:text-link [&_ol]:m-0 [&_ol]:pl-5 [&_p]:m-0 [&_ul]:m-0 [&_ul]:pl-5"
          v-html="renderedBody"
        />
      </div>
    </div>

    <MarkdownModulePopover
      v-if="editing"
      title="编辑提示块"
      :icon="draftTypeIcon"
      :position="popoverPosition"
      :width="460"
      @cancel="cancelEditing"
      @submit="saveEditing"
    >
      <div class="flex flex-col gap-3 p-3">
        <div class="flex gap-3">
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class="text-[11px] font-medium text-secondary">类型</span>
            <ModuleSelect v-model="draftType" :options="supportedTypes" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class="text-[11px] font-medium text-secondary">折叠方式</span>
            <ModuleSelect v-model="draftFold" :options="foldOptions" />
          </div>
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] font-medium text-secondary">标题</span>
          <span class="flex h-10 items-center rounded-lg border border-line bg-paper px-3 focus-within:border-muted/60">
            <input
              v-model="draftTitle"
              type="text"
              placeholder="输入提示块标题"
              class="h-full min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-muted/50"
              @keydown.enter.prevent="saveEditing"
            >
          </span>
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] font-medium text-secondary">内容</span>
          <span class="flex min-h-28 rounded-lg border border-line bg-paper px-3 py-2 focus-within:border-muted/60">
            <textarea
              v-model="draftBody"
              rows="5"
              spellcheck="false"
              placeholder="输入 Markdown 内容"
              class="min-h-24 min-w-0 flex-1 resize-none bg-transparent font-mono text-[12px] leading-5 text-ink outline-none placeholder:text-muted/50"
              @keydown.stop
            />
          </span>
        </label>
      </div>
    </MarkdownModulePopover>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, ref, watch } from 'vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import ModuleSelect from '../shared/ModuleSelect.vue'
import type { ModuleSelectOption } from '../shared/ModuleSelect.vue'
import { getNodeViewPopoverPosition } from '../shared/nodeViewPopover'
import { renderSafeMarkdown } from '../shared/safeMarkdown'

const props = defineProps<NodeViewProps>()

const supportedTypes: ModuleSelectOption[] = [
  { value: 'NOTE', label: '备注', description: '补充背景信息', icon: 'lucide:info', iconClass: 'text-muted' },
  { value: 'TIP', label: '提示', description: '提供建议或技巧', icon: 'lucide:check', iconClass: 'text-link' },
  { value: 'IMPORTANT', label: '重要', description: '标记关键信息', icon: 'lucide:alert-triangle', iconClass: 'text-folder' },
  { value: 'WARNING', label: '警告', description: '提醒潜在风险', icon: 'lucide:file-warning', iconClass: 'text-folder' },
  { value: 'CAUTION', label: '注意', description: '提示谨慎操作', icon: 'lucide:alert-triangle', iconClass: 'text-danger' },
]

const foldOptions: ModuleSelectOption[] = [
  { value: '', label: '不可折叠', description: '始终显示内容', icon: 'lucide:minus' },
  { value: '+', label: '默认展开', description: '可手动收起', icon: 'lucide:chevron-down' },
  { value: '-', label: '默认折叠', description: '打开时隐藏内容', icon: 'lucide:chevron-right' },
]

const anchorElement = ref<HTMLElement | null>(null)
const popoverPosition = ref<Record<string, string>>({ left: '12px', top: '12px' })
const editing = ref(false)
const collapsed = ref(String(props.node.attrs.fold) === '-')
const draftType = ref(String(props.node.attrs.calloutType))
const draftTitle = ref(String(props.node.attrs.title))
const draftFold = ref(String(props.node.attrs.fold))
const draftBody = ref(String(props.node.attrs.body))

const calloutType = computed(() => String(props.node.attrs.calloutType).toLocaleUpperCase())
const displayTitle = computed(() => String(props.node.attrs.title) || ({
  NOTE: '备注',
  TIP: '提示',
  IMPORTANT: '重要',
  WARNING: '警告',
  CAUTION: '注意',
}[calloutType.value] ?? '提示'))
const foldable = computed(() => ['+', '-'].includes(String(props.node.attrs.fold)))
const hasBody = computed(() => String(props.node.attrs.body).trim().length > 0)
const renderedBody = computed(() => renderSafeMarkdown(String(props.node.attrs.body)))
const typeIcon = computed(() => supportedTypes.find((type) => type.value === calloutType.value)?.icon ?? 'lucide:info')
const draftTypeIcon = computed(() => supportedTypes.find((type) => type.value === draftType.value)?.icon ?? 'lucide:info')

const typeStyle = computed(() => {
  // 每种提示只改变语义色，卡片结构保持一致，切换类型时界面不会跳动。
  const styles: Record<string, { surface: string; iconSurface: string; icon: string }> = {
    NOTE: { surface: 'border-line bg-toolbar', iconSurface: 'bg-control', icon: 'text-secondary' },
    TIP: { surface: 'border-link/30 bg-link/5', iconSurface: 'bg-link/10', icon: 'text-link' },
    IMPORTANT: { surface: 'border-folder/30 bg-folder/5', iconSurface: 'bg-folder/10', icon: 'text-folder' },
    WARNING: { surface: 'border-folder/30 bg-folder/5', iconSurface: 'bg-folder/10', icon: 'text-folder' },
    CAUTION: { surface: 'border-danger/30 bg-danger/5', iconSurface: 'bg-danger/10', icon: 'text-danger' },
  }
  return styles[calloutType.value] ?? styles.NOTE
})

const saveDraft = (): void => {
  props.updateAttributes({
    calloutType: draftType.value,
    title: draftTitle.value.trim(),
    fold: draftFold.value,
    body: draftBody.value.trimEnd(),
  })
  collapsed.value = draftFold.value === '-'
}

const startEditing = (): void => {
  if (!anchorElement.value) return
  popoverPosition.value = getNodeViewPopoverPosition(anchorElement.value, 460, 390)
  editing.value = true
}

const cancelEditing = (): void => {
  draftType.value = String(props.node.attrs.calloutType)
  draftTitle.value = String(props.node.attrs.title)
  draftFold.value = String(props.node.attrs.fold)
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
    draftType.value = String(attributes.calloutType)
    draftTitle.value = String(attributes.title)
    draftFold.value = String(attributes.fold)
    draftBody.value = String(attributes.body)
  },
)
</script>
