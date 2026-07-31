<template>
  <div ref="selectRoot" class="relative flex min-w-0 flex-col" @focusout="closeMenu">
    <button
      ref="triggerButton"
      type="button"
      class="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-paper px-3 text-left text-[12px] text-ink outline-none hover:border-muted/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      :class="menuOpen ? 'border-muted/60' : 'border-line'"
      @click.stop="toggleMenu"
      @keydown.down.prevent="focusSelectedOption"
      @keydown.esc.stop="closeAndFocusTrigger"
    >
      <span class="flex min-w-0 items-center gap-2">
        <Icon
          v-if="selectedOption.icon"
          :icon="selectedOption.icon"
          :size="14"
          class="shrink-0"
          :class="selectedOption.iconClass"
        />
        <span class="min-w-0 truncate font-medium">{{ selectedOption.label }}</span>
      </span>
      <Icon icon="lucide:chevron-down" :size="14" class="shrink-0 text-muted" />
    </button>

    <div
      v-if="menuOpen"
      ref="optionList"
      class="absolute left-0 top-11 z-40 flex w-full min-w-48 flex-col gap-0.5 rounded-lg border border-line bg-paper p-1.5"
      @keydown.esc.stop="closeAndFocusTrigger"
    >
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-control-hover focus-visible:bg-control-hover focus-visible:outline-none"
        :class="option.value === modelValue ? 'bg-selected text-ink' : 'text-secondary'"
        @click.stop="selectOption(option.value)"
      >
        <span class="flex min-w-0 items-center gap-2.5">
          <Icon
            v-if="option.icon"
            :icon="option.icon"
            :size="14"
            class="shrink-0"
            :class="option.iconClass"
          />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate text-[12px] font-medium text-ink">{{ option.label }}</span>
            <span v-if="option.description" class="truncate text-[10px] text-muted">{{ option.description }}</span>
          </span>
        </span>
        <Icon v-if="option.value === modelValue" icon="lucide:check" :size="13" class="shrink-0 text-ink" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'
import { computed, nextTick, ref } from 'vue'

export interface ModuleSelectOption {
  value: string
  label: string
  description?: string
  icon?: string
  iconClass?: string
}

const props = defineProps<{
  modelValue: string
  options: ModuleSelectOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const menuOpen = ref(false)
const selectRoot = ref<HTMLElement | null>(null)
const triggerButton = ref<HTMLButtonElement | null>(null)
const optionList = ref<HTMLElement | null>(null)
const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue) ?? props.options[0])

const toggleMenu = (): void => {
  menuOpen.value = !menuOpen.value
}

const selectOption = (value: string): void => {
  emit('update:modelValue', value)
  menuOpen.value = false
  triggerButton.value?.focus()
}

const closeMenu = (event: FocusEvent): void => {
  const nextElement = event.relatedTarget as HTMLElement | null
  if (!nextElement || !selectRoot.value?.contains(nextElement)) menuOpen.value = false
}

const closeAndFocusTrigger = (): void => {
  menuOpen.value = false
  triggerButton.value?.focus()
}

const focusSelectedOption = (): void => {
  menuOpen.value = true
  // 菜单渲染完成后再定位当前项，键盘操作时不会丢失焦点。
  void nextTick(() => {
    const optionButtons = optionList.value?.querySelectorAll<HTMLButtonElement>('button')
    optionButtons?.[Math.max(0, props.options.findIndex((option) => option.value === props.modelValue))]?.focus()
  })
}
</script>
