<template>
  <!-- 查找替换面板：固定在编辑区右上角，两种编辑模式共用。 -->
  <div v-show="isOpen" class="absolute right-3 top-2 z-50 flex w-[400px] flex-col gap-1 rounded-lg border border-line bg-toolbar p-1.5"
    @mousedown.stop>
    <!-- 查找行：输入、计数、大小写与上下跳转。 -->
    <div class="flex items-center gap-1">
      <Icon icon="lucide:search" :size="13" class="shrink-0 text-muted" />
      <input ref="findInput" v-model="queryModel" type="text" placeholder="查找" spellcheck="false"
        class="h-7 min-w-0 flex-1 rounded-md border border-line bg-paper px-2 text-[12px] text-ink outline-none placeholder:text-placeholder focus:border-accent"
        @keydown="handleFindKeydown" />
      <span class="w-11 shrink-0 text-right font-mono text-[10.5px] text-muted">{{ counterText }}</span>
      <button type="button" title="区分大小写"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        :class="caseSensitive ? 'bg-control-active text-accent' : 'text-muted hover:bg-control-hover hover:text-ink'"
        @click="controller.toggleCaseSensitive()">
        Aa
      </button>
      <button type="button" title="上一个匹配 (Shift+Enter)"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:text-muted/30"
        :disabled="matchCount === 0" @click="controller.goToPrev()">
        <Icon icon="lucide:arrow-up" :size="13" />
      </button>
      <button type="button" title="下一个匹配 (Enter)"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:text-muted/30"
        :disabled="matchCount === 0" @click="controller.goToNext()">
        <Icon icon="lucide:arrow-down" :size="13" />
      </button>
      <button type="button" title="关闭 (Esc)"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @click="controller.close()">
        <Icon icon="lucide:x" :size="13" />
      </button>
    </div>

    <!-- 替换行：替换输入与执行按钮。 -->
    <div class="flex items-center gap-1">
      <Icon icon="lucide:replace" :size="13" class="shrink-0 text-muted" />
      <input v-model="replacementModel" type="text" placeholder="替换为" spellcheck="false"
        class="h-7 min-w-0 flex-1 rounded-md border border-line bg-paper px-2 text-[12px] text-ink outline-none placeholder:text-placeholder focus:border-accent"
        @keydown="handleReplaceKeydown" />
      <button type="button" title="替换当前匹配 (Enter)"
        class="flex h-6 shrink-0 items-center justify-center rounded-md px-2 text-[11.5px] font-medium text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:text-muted/30"
        :disabled="matchCount === 0" @click="controller.replaceCurrent()">替换</button>
      <button type="button" title="替换全部匹配 (Shift+Enter)"
        class="flex h-6 shrink-0 items-center justify-center rounded-md px-2 text-[11.5px] font-medium text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:cursor-default disabled:text-muted/30"
        :disabled="matchCount === 0" @click="controller.replaceAll()">全部替换</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'
import { computed, nextTick, ref, watch } from 'vue'
import type { FindReplaceController } from '../composables/useFindReplace'

const props = defineProps<{ controller: FindReplaceController }>()
// 解构出控制器引用，后续读写其中的响应式值，避免触发对 props 本身的修改检查。
const controller = props.controller

const isOpen = computed(() => controller.isOpen.value)
const caseSensitive = computed(() => controller.caseSensitive.value)
const matchCount = computed(() => controller.matchCount.value)
const counterText = computed(() => {
  if (!controller.query.value || matchCount.value === 0) return ''
  return `${controller.currentIndex.value + 1}/${matchCount.value}`
})

// v-model 直接读写 controller 中的响应式值，避免模板里反复出现 .value。
const queryModel = computed({
  get: () => controller.query.value,
  set: (value: string) => { controller.query.value = value },
})
const replacementModel = computed({
  get: () => controller.replacement.value,
  set: (value: string) => { controller.replacement.value = value },
})

const findInput = ref<HTMLInputElement | null>(null)

// 输入关键词后重新收集匹配，保持计数、高亮和当前项实时同步。
watch(queryModel, () => controller.refresh())

// 面板打开或再次按 Ctrl+F 时，焦点回到查找框并全选已有内容，方便直接覆盖输入。
watch(
  () => controller.focusRequest.value,
  () => {
    if (!controller.isOpen.value) return
    void nextTick(() => {
      findInput.value?.focus()
      findInput.value?.select()
    })
  },
)

const handleFindKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (event.shiftKey) controller.goToPrev()
    else controller.goToNext()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    controller.close()
  }
}

const handleReplaceKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (event.shiftKey) controller.replaceAll()
    else controller.replaceCurrent()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    controller.close()
  }
}
</script>
