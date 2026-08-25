<template>
  <div ref="rootRef" class="model-selector">
    <div class="model-selector-input-wrap" :class="{ 'model-selector-focus': focused }">
      <Icon icon="lucide:cube" :size="15" class="model-selector-icon" />
      <input ref="inputRef" v-model="inputValue" type="text" class="model-selector-input" :placeholder="placeholder"
        @focus="onFocus" @blur="onBlur" @keydown="onKeyDown" />
      <button v-if="inputValue" type="button" class="model-selector-clear" @mousedown.prevent="clear">
        <Icon icon="lucide:x" :size="12" />
      </button>
      <button type="button" class="model-selector-fetch" :disabled="fetching" @mousedown.prevent="$emit('fetch')">
        <Icon :icon="fetching ? 'lucide:loader-2' : 'lucide:refresh-cw'" :size="13"
          :class="{ 'animate-spin': fetching }" />
      </button>
    </div>

    <Transition name="model-dropdown">
      <div v-if="showDropdown" class="model-selector-dropdown">
        <div v-if="fetchError" class="model-selector-error">
          <Icon icon="lucide:alert-circle" :size="14" />
          <span>{{ fetchError }}</span>
        </div>

        <!-- 已保存的自定义模型 -->
        <div v-if="customModels.length > 0 && !inputValue.trim()" class="model-selector-section">
          <div class="model-selector-section-header">
            <span>自定义模型</span>
          </div>
          <div class="model-selector-list">
            <div v-for="(m, index) in customModels" :key="'custom-' + m" :ref="(el) => setItemRef(el, index)"
              class="model-selector-option" :class="{
                'model-selector-active': index === activeIndex,
                'model-selector-selected': modelValue === m,
              }" tabindex="0" @mousedown.prevent="selectOption(m)" @mouseenter="activeIndex = index">
              <Icon icon="lucide:pencil" :size="14" class="model-selector-option-type-icon" />
              <div class="model-selector-option-main">
                <span class="model-selector-option-name">{{ m }}</span>
              </div>
              <button type="button" class="model-selector-remove" tabindex="-1"
                @mousedown.prevent.stop="removeCustom(m)">
                <Icon icon="lucide:trash-2" :size="12" />
              </button>
            </div>
          </div>
        </div>

        <!-- 从 API 获取的模型 -->
        <div v-if="filteredOptions.length > 0" class="model-selector-section">
          <div v-if="customModels.length > 0 && !inputValue.trim()" class="model-selector-section-header">
            <span>可用模型</span>
          </div>
          <div class="model-selector-list">
            <button v-for="(option, index) in filteredOptions" :key="option.id"
              :ref="(el) => setItemRef(el, customModels.length + index)" type="button" class="model-selector-option"
              :class="{
                'model-selector-active': customModels.length + index === activeIndex,
                'model-selector-selected': modelValue === option.id,
              }" @mousedown.prevent="selectOption(option.id)" @mouseenter="activeIndex = customModels.length + index">
              <div class="model-selector-option-main">
                <span class="model-selector-option-name">{{ option.name ?? option.id }}</span>
                <span v-if="option.name && option.name !== option.id" class="model-selector-option-id">{{ option.id
                  }}</span>
              </div>
              <Icon v-if="modelValue === option.id" icon="lucide:check" :size="14" class="model-selector-check" />
            </button>
          </div>
        </div>

        <!-- 添加自定义模型 -->
        <div v-if="inputValue.trim() && !exactMatch && !isCustomModel" class="model-selector-add-custom">
          <button type="button" class="model-selector-option"
            :class="{ 'model-selector-active': activeIndex === totalOptions }"
            :ref="(el) => setItemRef(el, totalOptions)" @mousedown.prevent="addCustom"
            @mouseenter="activeIndex = totalOptions">
            <Icon icon="lucide:plus-circle" :size="14" class="model-selector-add-icon" />
            <div class="model-selector-option-main">
              <span class="model-selector-option-name">添加为自定义模型</span>
              <span class="model-selector-option-id">{{ inputValue.trim() }}</span>
            </div>
          </button>
        </div>

        <!-- 空状态 -->
        <div
          v-if="!fetching && filteredOptions.length === 0 && customModels.length === 0 && !inputValue.trim() && !fetchError"
          class="model-selector-empty">
          点击右侧刷新按钮获取可用模型
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { AiModelInfo } from '../../types/ai'

const props = defineProps<{
  modelValue: string
  placeholder?: string
  customModels?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:customModels': [models: string[]]
  fetch: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const itemRefs = ref<(HTMLElement | null)[]>([])

const inputValue = ref(props.modelValue)
const focused = ref(false)
const showDropdown = ref(false)
const activeIndex = ref(-1)
const fetching = ref(false)
const fetchError = ref('')
const availableModels = ref<AiModelInfo[]>([])

// 同步外部值
watch(() => props.modelValue, (v) => {
  inputValue.value = v
})

const customModels = computed(() => props.customModels ?? [])

const filteredOptions = computed(() => {
  const q = inputValue.value.trim().toLowerCase()
  if (!q) return availableModels.value
  return availableModels.value.filter(
    (m) => m.id.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q))
  )
})

const exactMatch = computed(() => {
  const q = inputValue.value.trim().toLowerCase()
  return availableModels.value.some((m) => m.id.toLowerCase() === q)
})

const isCustomModel = computed(() => {
  const q = inputValue.value.trim()
  return customModels.value.includes(q)
})

const totalOptions = computed(() => {
  const base = inputValue.value.trim() ? 0 : customModels.value.length
  return base + filteredOptions.value.length
})

const setItemRef = (el: unknown, index: number) => {
  itemRefs.value[index] = el as HTMLElement | null
}

const onFocus = () => {
  focused.value = true
  showDropdown.value = true
  activeIndex.value = -1
}

const onBlur = () => {
  focused.value = false
  setTimeout(() => {
    showDropdown.value = false
    // 失焦时提交当前输入值
    const value = inputValue.value.trim()
    if (value) {
      emit('update:modelValue', value)
    }
  }, 150)
}

const onKeyDown = (e: KeyboardEvent) => {
  const total = totalOptions.value + (inputValue.value.trim() && !exactMatch.value && !isCustomModel.value ? 1 : 0)
  if (!showDropdown.value || total === 0) return

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      activeIndex.value = (activeIndex.value + 1) % total
      scrollToActive()
      break
    case 'ArrowUp':
      e.preventDefault()
      activeIndex.value = (activeIndex.value - 1 + total) % total
      scrollToActive()
      break
    case 'Enter':
      e.preventDefault()
      if (activeIndex.value >= 0 && activeIndex.value < customModels.value.length && !inputValue.value.trim()) {
        selectOption(customModels.value[activeIndex.value])
      } else if (activeIndex.value < totalOptions.value) {
        const modelIndex = inputValue.value.trim() ? activeIndex.value : activeIndex.value - customModels.value.length
        if (modelIndex >= 0 && modelIndex < filteredOptions.value.length) {
          selectOption(filteredOptions.value[modelIndex].id)
        }
      } else if (activeIndex.value === totalOptions.value) {
        addCustom()
      }
      break
    case 'Escape':
      e.preventDefault()
      showDropdown.value = false
      inputRef.value?.blur()
      break
  }
}

const scrollToActive = () => {
  nextTick(() => {
    const el = itemRefs.value[activeIndex.value]
    el?.scrollIntoView({ block: 'nearest' })
  })
}

const selectOption = (id: string) => {
  inputValue.value = id
  emit('update:modelValue', id)
  showDropdown.value = false
  inputRef.value?.blur()
}

const addCustom = () => {
  const value = inputValue.value.trim()
  if (!value || customModels.value.includes(value)) return
  const newList = [...customModels.value, value]
  emit('update:customModels', newList)
  emit('update:modelValue', value)
  showDropdown.value = false
  inputRef.value?.blur()
}

const removeCustom = (model: string) => {
  const newList = customModels.value.filter((m) => m !== model)
  emit('update:customModels', newList)
  // 如果删除的是当前选中的模型，清空选择
  if (props.modelValue === model) {
    emit('update:modelValue', '')
    inputValue.value = ''
  }
}

const clear = () => {
  inputValue.value = ''
  emit('update:modelValue', '')
  inputRef.value?.focus()
}

// 供父组件调用
const setModels = (models: AiModelInfo[]) => {
  availableModels.value = models
  fetching.value = false
  if (models.length > 0 || customModels.value.length > 0) {
    showDropdown.value = true
    fetchError.value = ''
  }
}

const setError = (error: string) => {
  fetchError.value = error
  fetching.value = false
}

const startLoading = () => {
  fetching.value = true
  fetchError.value = ''
}

defineExpose({ setModels, setError, startLoading })
</script>

<style scoped>
.model-selector {
  position: relative;
  width: 200px;
}

.model-selector-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background-color: var(--color-panel);
  padding: 0 6px 0 10px;
  transition: border-color 0.15s, box-shadow 0.15s;
  box-sizing: border-box;
}

.model-selector-input-wrap:hover {
  border-color: var(--color-muted);
}

.model-selector-focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent);
}

.model-selector-icon {
  flex-shrink: 0;
  color: var(--color-muted);
}

.model-selector-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--color-ink);
  font-size: 13px;
  outline: none;
}

.model-selector-input::placeholder {
  color: var(--color-placeholder);
}

.model-selector-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: background-color 0.1s, color 0.1s, opacity 0.15s;
  opacity: 0;
}

.model-selector-input-wrap:hover .model-selector-clear,
.model-selector-focus .model-selector-clear {
  opacity: 1;
}

.model-selector-fetch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  transition: background-color 0.1s, color 0.1s;
}

.model-selector-clear:hover,
.model-selector-fetch:hover {
  background-color: var(--color-toolbar);
  color: var(--color-ink);
}

.model-selector-fetch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-selector-dropdown {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 50;
  max-height: 360px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background-color: var(--color-paper);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
}

:root.dark .model-selector-dropdown {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.2);
}

.model-selector-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: var(--color-danger);
  font-size: 12px;
  border-bottom: 1px solid var(--color-line);
}

.model-selector-section {
  overflow: hidden;
}

.model-selector-section-header {
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.model-selector-list {
  overflow-y: auto;
  padding: 4px;
  max-height: 240px;
}

.model-selector-add-custom {
  border-top: 1px solid var(--color-line);
  padding: 4px;
}

.model-selector-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-ink);
  cursor: pointer;
  transition: background-color 0.08s;
  text-align: left;
  outline: none;
}

.model-selector-option:hover,
.model-selector-option:focus,
.model-selector-active {
  background-color: var(--color-toolbar);
}

.model-selector-selected {
  background-color: var(--color-selected);
}

.model-selector-selected:hover,
.model-selector-selected.model-selector-active {
  background-color: var(--color-selected);
}

.model-selector-option-type-icon {
  flex-shrink: 0;
  color: var(--color-muted);
}

.model-selector-option-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.model-selector-option-name {
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-selector-option-id {
  font-size: 11px;
  line-height: 16px;
  color: var(--color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-selector-check {
  flex-shrink: 0;
  color: var(--color-accent);
}

.model-selector-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s, background-color 0.1s, color 0.1s;
}

.model-selector-option:hover .model-selector-remove {
  opacity: 1;
}

.model-selector-remove:hover {
  background-color: var(--color-danger);
  color: var(--color-inverse);
}

.model-selector-add-icon {
  flex-shrink: 0;
  color: var(--color-accent);
}

.model-selector-empty {
  padding: 16px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--color-muted);
}

/* 下拉动画 */
.model-dropdown-enter-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.model-dropdown-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.model-dropdown-enter-from,
.model-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
