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
      @keydown.esc.stop="menuOpen = false"
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

      <div class="editor-scroll flex max-h-56 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-1">
        <button
          v-for="language in filteredLanguages"
          :key="language.value"
          type="button"
          class="flex h-8 shrink-0 items-center justify-between rounded-md px-2 text-left text-[10.5px] outline-none"
          :class="language.value === modelValue ? style.menuSelectedClass : style.menuOptionClass"
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
import { computed, nextTick, ref } from 'vue'
import type { CodeBlockStyle } from '../../modules/codeBlockStyles'
import { codeBlockLanguages, getCodeBlockLanguageLabel } from '../../modules/codeBlockLanguages'

const props = defineProps<{ modelValue: string; style: CodeBlockStyle }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const menuOpen = ref(false)
const picker = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const search = ref('')

const selectedLabel = computed(() => getCodeBlockLanguageLabel(props.modelValue))
const visibleLanguages = computed(() => {
  if (codeBlockLanguages.some((language) => language.value === props.modelValue)) return codeBlockLanguages
  return [{ value: props.modelValue, label: props.modelValue }, ...codeBlockLanguages]
})
const filteredLanguages = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  if (!query) return visibleLanguages.value
  return visibleLanguages.value.filter((language) =>
    language.label.toLocaleLowerCase().includes(query) || language.value.toLocaleLowerCase().includes(query),
  )
})

const toggleMenu = (): void => {
  menuOpen.value = !menuOpen.value
  search.value = ''
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
</script>
