<template>
  <div ref="rootRef" class="icon-select" @keydown="onKeyDown">
    <button
      ref="triggerRef"
      type="button"
      class="icon-select-trigger"
      :class="{ 'icon-select-open': open }"
      @click="toggle"
    >
      <Icon v-if="currentOption?.icon" :icon="currentOption.icon" :size="16" class="icon-select-icon" />
      <span class="icon-select-label">{{ currentOption?.label ?? placeholder }}</span>
      <Icon icon="lucide:chevron-down" :size="14" class="icon-select-chevron" :class="{ 'icon-select-chevron-open': open }" />
    </button>

    <Transition name="icon-select-dropdown">
      <div v-if="open" class="icon-select-dropdown">
        <button
          v-for="(option, index) in options"
          :key="option.value"
          :ref="(el) => setItemRef(el, index)"
          type="button"
          class="icon-select-option"
          :class="{ 'icon-select-selected': modelValue === option.value }"
          @click="select(option)"
        >
          <Icon v-if="option.icon" :icon="option.icon" :size="16" class="icon-select-icon" />
          <span class="icon-select-option-label">{{ option.label }}</span>
          <Icon v-if="modelValue === option.value" icon="lucide:check" :size="14" class="icon-select-check" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'

export interface IconSelectOption {
  value: string
  label: string
  icon?: string
}

const props = defineProps<{
  modelValue: string
  options: IconSelectOption[]
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const itemRefs = ref<(HTMLElement | null)[]>([])
const focusIndex = ref(-1)

const currentOption = computed(() => props.options.find((o) => o.value === props.modelValue))

const setItemRef = (el: unknown, index: number) => {
  itemRefs.value[index] = el as HTMLElement | null
}

const close = (restoreFocus = false) => {
  open.value = false
  focusIndex.value = -1
  if (restoreFocus) nextTick(() => triggerRef.value?.focus())
}

const toggle = () => {
  if (open.value) close(true)
  else {
    open.value = true
    nextTick(() => {
      const idx = props.options.findIndex((o) => o.value === props.modelValue)
      focusItem(idx >= 0 ? idx : 0)
    })
  }
}

const select = (option: IconSelectOption) => {
  emit('update:modelValue', option.value)
  close(true)
}

const focusItem = (index: number) => {
  const items = itemRefs.value.filter(Boolean)
  if (items.length === 0) return
  const clamped = Math.max(0, Math.min(index, items.length - 1))
  focusIndex.value = clamped
  items[clamped]?.focus()
}

const onKeyDown = (e: KeyboardEvent) => {
  if (!open.value) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
    return
  }
  switch (e.key) {
    case 'Escape':
      e.preventDefault()
      close(true)
      break
    case 'ArrowDown':
      e.preventDefault()
      focusItem(focusIndex.value + 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      focusItem(focusIndex.value - 1)
      break
    case 'Enter':
    case ' ':
      e.preventDefault()
      if (focusIndex.value >= 0) select(props.options[focusIndex.value])
      break
    case 'Home':
      e.preventDefault()
      focusItem(0)
      break
    case 'End':
      e.preventDefault()
      focusItem(props.options.length - 1)
      break
  }
}

const onClickOutside = (e: MouseEvent) => {
  if (!rootRef.value?.contains(e.target as Node)) close()
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))

watch(() => props.options.length, () => {
  itemRefs.value = []
})
</script>

<style scoped>
.icon-select {
  position: relative;
  min-width: 0;
}

.icon-select-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  min-width: 180px;
  max-width: 420px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background-color: var(--color-panel);
  color: var(--color-ink);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.icon-select-trigger:hover {
  border-color: var(--color-muted);
}

.icon-select-open {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent);
}

.icon-select-icon {
  flex-shrink: 0;
  color: var(--color-icon);
}

.icon-select-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.icon-select-chevron {
  flex-shrink: 0;
  color: var(--color-muted);
  transition: transform 0.2s ease;
}

.icon-select-chevron-open {
  transform: rotate(180deg);
}

.icon-select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  min-width: 180px;
  max-width: 420px;
  z-index: 50;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background-color: var(--color-paper);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04);
  padding: 4px;
  overflow: hidden;
}

:root.dark .icon-select-dropdown {
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), 0 1px 4px rgba(0, 0, 0, 0.2);
}

.icon-select-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 10px 0 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-ink);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.1s;
}

.icon-select-option:hover,
.icon-select-option:focus {
  background-color: var(--color-toolbar);
  outline: none;
}

.icon-select-selected {
  background-color: var(--color-selected);
}

.icon-select-selected:hover,
.icon-select-selected:focus {
  background-color: var(--color-selected);
}

.icon-select-option-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.icon-select-check {
  flex-shrink: 0;
  color: var(--color-accent);
}

/* Dropdown transition */
.icon-select-dropdown-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.icon-select-dropdown-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.icon-select-dropdown-enter-from,
.icon-select-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
