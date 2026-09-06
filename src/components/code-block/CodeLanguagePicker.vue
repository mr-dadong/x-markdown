<template>
  <div ref="picker" class="relative flex min-w-0" @focusout="closeMenu">
    <button
      type="button"
      title="选择代码语言"
      class="flex h-7 max-w-36 items-center gap-1.5 rounded px-2 text-[11px] font-medium outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      :class="[style.headerTextClass, style.headerHoverClass]"
      @click.stop="toggleMenu"
    >
      <Icon icon="lucide:code-2" :size="13" class="shrink-0" />
      <span class="min-w-0 truncate">{{ selectedLabel }}</span>
      <Icon icon="lucide:chevron-down" :size="12" class="shrink-0" />
    </button>

    <div
      v-if="menuOpen"
      class="absolute left-0 top-9 z-30 flex w-48 flex-col rounded-lg border p-2"
      :class="style.menuClass"
      @keydown="handleMenuKeydown"
    >
      <div class="mb-2 flex h-9 items-center gap-2 rounded-md border px-2.5" :class="style.menuSearchClass">
        <Icon icon="lucide:search" :size="13" class="shrink-0" />
        <input
          ref="searchInput"
          v-model="search"
          type="text"
          title="搜索代码语言"
          placeholder="搜索语言"
          class="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-current placeholder:opacity-60"
          @click.stop
        />
      </div>

      <!-- 隐藏右侧竖向滚动条但保留滚动能力，列表较长时用上下键或滚轮仍然可以滚动。 -->
      <div
        ref="listRef"
        class="[scrollbar-width:none] flex max-h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain"
      >
        <button
          v-for="(language, index) in filteredLanguages"
          :key="language.value"
          type="button"
          class="flex h-8 shrink-0 items-center justify-between rounded-md px-2 text-left text-[10.5px] outline-none"
          :data-language-highlighted="index === highlightedIndex || undefined"
          :class="index === highlightedIndex ? style.menuHighlightClass : language.value === modelValue ? style.menuSelectedClass : style.menuOptionClass"
          @mouseenter="highlightedIndex = index"
          @click.stop="selectLanguage(language.value)"
        >
          <span class="min-w-0 truncate">{{ language.label }}</span>
          <Icon v-if="language.value === modelValue" icon="lucide:check" :size="12" class="ml-2 shrink-0" />
        </button>

        <div v-if="!filteredLanguages.length" class="flex h-16 shrink-0 items-center justify-center text-[10.5px] opacity-70">
          没有匹配的语言
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'
import { computed, nextTick, ref, watch } from 'vue'
import type { CodeBlockStyle } from '../../modules/codeBlockStyles'
import { codeBlockLanguages, getCodeBlockLanguageLabel, type CodeBlockLanguage } from '../../modules/codeBlockLanguages'

const props = defineProps<{ modelValue: string; style: CodeBlockStyle }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const menuOpen = ref(false)
const picker = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const search = ref('')
// 键盘上下键与鼠标悬停共用同一个高亮索引，保证两种操作的高亮视觉一致。
const highlightedIndex = ref(0)

const selectedLabel = computed(() => getCodeBlockLanguageLabel(props.modelValue))
const visibleLanguages = computed(() => {
  if (codeBlockLanguages.some((language) => language.value === props.modelValue)) return codeBlockLanguages
  return [{ value: props.modelValue, label: props.modelValue }, ...codeBlockLanguages]
})
const filteredLanguages = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  if (!query) return visibleLanguages.value
  // 首字母匹配：语言名称或标识以查询词开头（不区分大小写）。
  const isPrefixMatch = (language: CodeBlockLanguage): boolean =>
    language.label.toLocaleLowerCase().startsWith(query) || language.value.toLocaleLowerCase().startsWith(query)
  const matched = visibleLanguages.value.filter((language) => {
    const label = language.label.toLocaleLowerCase()
    const value = language.value.toLocaleLowerCase()
    return label.includes(query) || value.includes(query)
  })
  // 首字母匹配的语言排在前面，其余模糊匹配排在后面，各组内保持原有列表顺序。
  return [...matched.filter(isPrefixMatch), ...matched.filter((language) => !isPrefixMatch(language))]
})

const toggleMenu = (): void => {
  menuOpen.value = !menuOpen.value
  search.value = ''
  // 打开菜单时默认高亮第一个元素，直接回车即可选中。
  highlightedIndex.value = 0
  if (menuOpen.value) void nextTick(() => searchInput.value?.focus())
}

const selectLanguage = (language: string): void => {
  emit('update:modelValue', language)
  menuOpen.value = false
}

const closeMenu = (event: FocusEvent): void => {
  const nextElement = event.relatedTarget as HTMLElement | null
  if (!nextElement || !picker.value?.contains(nextElement)) menuOpen.value = false
}

// 搜索词变化时过滤结果整体替换，高亮回到第一项，避免落在已不可见的旧位置上。
watch(search, () => {
  highlightedIndex.value = 0
})

// 键盘上下键循环选择，回车选中当前高亮项；在搜索框内输入时同样生效。
const handleMenuKeydown = (event: KeyboardEvent): void => {
  // 中文输入法组词阶段的方向键与回车属于输入法，不参与语言选择。
  if (event.isComposing) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const count = filteredLanguages.value.length
    if (count === 0) return
    const step = event.key === 'ArrowDown' ? 1 : -1
    highlightedIndex.value = (highlightedIndex.value + step + count) % count
    scrollHighlightedIntoView()
    return
  }

  if (event.key === 'Enter') {
    const language = filteredLanguages.value[highlightedIndex.value]
    if (!language) return
    event.preventDefault()
    selectLanguage(language.value)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    menuOpen.value = false
  }
}

const scrollHighlightedIntoView = (): void => {
  void nextTick(() => {
    listRef.value?.querySelector('[data-language-highlighted]')?.scrollIntoView({ block: 'nearest' })
  })
}
</script>
