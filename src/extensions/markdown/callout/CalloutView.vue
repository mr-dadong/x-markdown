<template>
  <NodeViewWrapper class="relative my-[0.8em] flex w-full flex-col" data-xmd-callout-view>
    <div
      class="relative flex w-full items-start gap-3 rounded-lg border border-l-[3px] px-3.5 py-3"
      :class="[typeStyle.surface, props.selected ? 'outline outline-1 outline-accent/30' : '']"
      contenteditable="false"
      title="点击编辑提示块"
      @click.stop="startEditing"
    >
      <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" :class="typeStyle.iconSurface">
        <Icon :icon="typeIcon" :size="14" :class="typeStyle.icon" />
      </div>

      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex min-h-6 min-w-0 items-center justify-between gap-3">
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
          </div>
        </div>

        <div
          v-if="!collapsed && hasBody"
          class="text-[14px] leading-6 text-secondary [&_a]:text-link [&_ol]:m-0 [&_ol]:pl-5 [&_p]:m-0 [&_ul]:m-0 [&_ul]:pl-5"
          v-html="renderedBody"
        />
      </div>
    </div>

    <!-- 类型在 / 菜单插入时定死，标题自动用类型名；弹层与公式块、Mermaid 一致，只编辑正文。 -->
    <MarkdownModulePopover v-if="editing" :width="460" full-width @cancel="cancelEditing" @submit="saveEditing">
      <MarkdownSourceInput v-model="draft" language="callout" :min-height="120" @submit="saveEditing" />
    </MarkdownModulePopover>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { Icon } from '@iconify/vue/offline'
import { computed, ref, watch } from 'vue'
import MarkdownModulePopover from '../shared/MarkdownModulePopover.vue'
import MarkdownSourceInput from '../shared/MarkdownSourceInput.vue'
import { renderSafeMarkdown } from '../shared/safeMarkdown'

const props = defineProps<NodeViewProps>()

const editing = ref(false)
const draft = ref('')
const collapsed = ref(String(props.node.attrs.fold) === '-')

const calloutType = computed(() => String(props.node.attrs.calloutType).toLocaleUpperCase())
// 标题为空时卡片标题直接显示类型名。
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
const typeIcon = computed(() => ({
  NOTE: 'lucide:info',
  TIP: 'lucide:check',
  IMPORTANT: 'lucide:alert-triangle',
  WARNING: 'lucide:file-warning',
  CAUTION: 'lucide:alert-triangle',
}[calloutType.value] ?? 'lucide:info'))

const getTypeStyle = (type: string): { surface: string; iconSurface: string; icon: string } => {
  // 每种提示只改变语义色，卡片结构保持一致，切换类型时界面不会跳动。
  const styles: Record<string, { surface: string; iconSurface: string; icon: string }> = {
    NOTE: { surface: 'border-line border-l-secondary bg-toolbar', iconSurface: 'bg-control', icon: 'text-secondary' },
    TIP: { surface: 'border-link/20 border-l-link bg-link/5', iconSurface: 'bg-link/10', icon: 'text-link' },
    IMPORTANT: { surface: 'border-folder/20 border-l-folder bg-folder/5', iconSurface: 'bg-folder/10', icon: 'text-folder' },
    WARNING: { surface: 'border-folder/20 border-l-folder bg-folder/5', iconSurface: 'bg-folder/10', icon: 'text-folder' },
    CAUTION: { surface: 'border-danger/20 border-l-danger bg-danger/5', iconSurface: 'bg-danger/10', icon: 'text-danger' },
  }
  return styles[type] ?? styles.NOTE
}

const typeStyle = computed(() => getTypeStyle(calloutType.value))

const startEditing = (): void => {
  if (editing.value) return
  draft.value = String(props.node.attrs.body)
  editing.value = true
}

const cancelEditing = (): void => {
  editing.value = false
}

const saveEditing = (): void => {
  // 类型、折叠、标题都在插入时定死，这里只保存正文。
  props.updateAttributes({ body: draft.value.trimEnd() })
  editing.value = false
}

watch(
  () => props.node.attrs.body,
  (body) => {
    // 编辑中不同步，避免覆盖用户正在输入的草稿；退出后按最新属性重建。
    if (!editing.value) draft.value = String(body)
  },
)
</script>
