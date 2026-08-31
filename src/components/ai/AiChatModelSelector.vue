<template>
  <div ref="rootRef" class="relative min-w-0">
    <!-- 触发按钮：带发丝线边框的模型芯片，类似 macOS 弹出按钮 -->
    <button
      type="button"
      class="flex h-6 min-w-0 max-w-[180px] cursor-pointer items-center gap-1 rounded-full border border-line bg-paper px-2 text-[11px] font-medium text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="disabled"
      :title="buttonTitle"
      @click="toggleOpen"
    >
      <Icon icon="lucide:cpu" :size="12" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ buttonLabel }}</span>
      <Icon :icon="open ? 'lucide:chevron-up' : 'lucide:chevron-down'" :size="12" class="shrink-0" />
    </button>

    <!-- 下拉列表（向上弹出） -->
    <div v-if="open" class="chat-model-drop">
      <!-- 头部：标题 + 刷新 -->
      <div class="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
        <span class="text-[11px] font-semibold text-muted">选择模型</span>
        <button
          type="button"
          title="刷新模型列表"
          class="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="loading"
          @click="emit('refresh')"
        >
          <Icon :icon="loading ? 'lucide:loader-2' : 'lucide:refresh-cw'" :size="13" :class="{ 'animate-spin': loading }" />
        </button>
      </div>

      <div class="chat-model-scroll flex min-h-0 flex-col overflow-y-auto p-1">
        <!-- 错误态 -->
        <div v-if="error" class="flex items-center gap-2 px-2 py-2 text-[12px] text-danger">
          <Icon icon="lucide:alert-circle" :size="13" class="shrink-0" />
          <span class="min-w-0 flex-1 break-all">{{ error }}</span>
        </div>

        <!-- 加载态 -->
        <div v-else-if="loading" class="flex items-center gap-2 px-2 py-2 text-[12px] text-muted">
          <Icon icon="lucide:loader-2" :size="13" class="animate-spin shrink-0" />
          <span>正在获取模型…</span>
        </div>

        <template v-else>
          <!-- 默认项：跟随设置页当前厂商的模型 -->
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-toolbar"
            :class="{ 'bg-selected': current === '' }"
            @click="choose('')"
          >
            <Icon icon="lucide:settings-2" :size="13" class="shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate">
              默认<template v-if="defaultModel">（{{ defaultModel }}）</template>
            </span>
            <Icon v-if="current === ''" icon="lucide:check" :size="13" class="shrink-0 text-accent" />
          </button>

          <!-- 当前选中的模型不在列表中时置顶显示，避免误清合法模型 -->
          <template v-if="orphanModel">
            <div class="px-2 pb-1 pt-2 text-[10px] font-semibold text-muted">当前选择</div>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg bg-selected px-2 py-1.5 text-left text-[12px] text-ink hover:bg-toolbar"
              @click="choose(orphanModel)"
            >
              <Icon icon="lucide:pencil" :size="13" class="shrink-0 text-muted" />
              <span class="min-w-0 flex-1 truncate">{{ orphanModel }}</span>
              <Icon icon="lucide:check" :size="13" class="shrink-0 text-accent" />
            </button>
          </template>

          <!-- 自定义模型 -->
          <template v-if="customModels.length > 0">
            <div class="px-2 pb-1 pt-2 text-[10px] font-semibold text-muted">自定义模型</div>
            <button
              v-for="m in customModels"
              :key="'custom-' + m"
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-toolbar"
              :class="{ 'bg-selected': current === m }"
              @click="choose(m)"
            >
              <Icon icon="lucide:pencil" :size="13" class="shrink-0 text-muted" />
              <span class="min-w-0 flex-1 truncate">{{ m }}</span>
              <Icon v-if="current === m" icon="lucide:check" :size="13" class="shrink-0 text-accent" />
            </button>
          </template>

          <!-- 可用模型 -->
          <template v-if="models.length > 0">
            <div class="px-2 pb-1 pt-2 text-[10px] font-semibold text-muted">可用模型</div>
            <button
              v-for="m in models"
              :key="m.id"
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-toolbar"
              :class="{ 'bg-selected': current === m.id }"
              @click="choose(m.id)"
            >
              <span class="min-w-0 flex-1 truncate">{{ m.name ?? m.id }}</span>
              <Icon v-if="current === m.id" icon="lucide:check" :size="13" class="shrink-0 text-accent" />
            </button>
          </template>

          <!-- 空状态 -->
          <div
            v-if="!error && models.length === 0 && customModels.length === 0"
            class="px-2 py-3 text-center text-[12px] text-muted"
          >
            暂无可用模型，点击刷新重试
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { AiModelInfo } from '../../types/ai'

const props = defineProps<{
  /** 当前选中的模型；空字符串表示跟随设置页默认模型 */
  current: string
  /** 设置页当前厂商的模型名（默认项展示用） */
  defaultModel: string
  models: AiModelInfo[]
  customModels: string[]
  loading: boolean
  error: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** 用户选择了某个模型；'' 表示回到默认 */
  select: [id: string]
  refresh: []
  /** 下拉展开时触发，供父组件懒加载模型列表 */
  open: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const open = ref(false)

// 当前选中的模型不在自定义和可用列表中时（如模型下线、列表不全），置顶固定显示
const orphanModel = computed(() => {
  const value = props.current.trim()
  if (!value) return ''
  const inCustom = props.customModels.includes(value)
  const inList = props.models.some((m) => m.id === value)
  return inCustom || inList ? '' : value
})

const buttonLabel = computed(() => props.current.trim() || props.defaultModel || '选择模型')

const buttonTitle = computed(() =>
  props.current.trim() ? `当前模型：${props.current}` : `默认模型：${props.defaultModel}`,
)

const toggleOpen = (): void => {
  if (props.disabled) return
  open.value = !open.value
}

const choose = (id: string): void => {
  emit('select', id)
  open.value = false
}

// 展开时通知父组件（懒加载模型列表），同时注册点击外部关闭监听
watch(open, (value) => {
  if (value) {
    emit('open')
    document.addEventListener('mousedown', onDocumentMousedown)
    document.addEventListener('keydown', onDocumentKeydown)
  } else {
    document.removeEventListener('mousedown', onDocumentMousedown)
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMousedown)
  document.removeEventListener('keydown', onDocumentKeydown)
})

const onDocumentMousedown = (event: MouseEvent): void => {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) {
    open.value = false
  }
}

const onDocumentKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') open.value = false
}
</script>

<style scoped>
/* 向上弹出的毛玻璃面板：半透明材质加发丝线边框 */
.chat-model-drop {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 50;
  display: flex;
  flex-direction: column;
  width: 260px;
  max-height: 320px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-paper) 86%, transparent);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
}

:root.dark .chat-model-drop {
  background: color-mix(in srgb, var(--color-paper) 78%, transparent);
}

/* 列表区专用细滚动条，避免使用主编辑区规格 */
.chat-model-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--color-scrollbar) transparent;
}

.chat-model-scroll::-webkit-scrollbar {
  width: 4px;
}

.chat-model-scroll::-webkit-scrollbar-thumb {
  background: var(--color-scrollbar);
  border-radius: 2px;
}
</style>
