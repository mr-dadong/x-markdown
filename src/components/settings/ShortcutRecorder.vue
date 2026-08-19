<template>
  <div class="flex shrink-0 flex-col items-end gap-1">
    <button type="button"
      class="flex h-8 min-w-[128px] items-center justify-center gap-1 rounded-md border px-2.5 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      :class="recording
        ? 'border-accent bg-selected text-accent'
        : parts.length > 0
          ? 'border-line bg-panel text-secondary hover:border-accent hover:text-ink'
          : 'border-dashed border-line text-muted hover:border-accent hover:text-secondary'"
      :title="recording ? '按下新的组合键，Esc 取消，退格清除' : '点击后按下新的组合键'" @click="startRecording"
      @blur="stopRecording">
      <template v-if="recording">
        <span class="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        <span class="text-[12px]">按下组合键…</span>
      </template>
      <template v-else-if="parts.length > 0">
        <kbd v-for="part in parts" :key="part"
          class="flex h-5 min-w-5 items-center justify-center rounded border border-line bg-paper px-1 font-mono text-[11px] leading-none text-secondary">
          {{ part }}
        </kbd>
      </template>
      <span v-else class="text-[12px]">未设置</span>
    </button>
    <span v-if="error" class="max-w-[200px] text-right text-[11px] leading-4 text-danger">{{ error }}</span>
    <span v-else-if="conflictLabel" class="max-w-[200px] text-right text-[11px] leading-4 text-danger">
      与「{{ conflictLabel }}」重复
    </span>
    <span v-else class="text-[11px] leading-4 text-muted">点击录制 · 退格清除</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { formatShortcutParts, parseShortcut, shortcutFromEvent } from '../../utils/shortcuts'

const props = defineProps<{
  modelValue: string
  /** 当前值与另一个动作重复时，传入对方名称用于提示。 */
  conflictLabel?: string
  /** 录制到新组合后提交前校验；返回错误文案则拒绝提交。 */
  validate?: (value: string) => string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const recording = ref(false)
const error = ref('')
const parts = computed(() => formatShortcutParts(props.modelValue))

let keydownHandler: ((event: KeyboardEvent) => void) | null = null
let errorTimer: ReturnType<typeof setTimeout> | null = null

const stopRecording = (): void => {
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler, true)
    keydownHandler = null
  }
  recording.value = false
}

const showError = (message: string): void => {
  error.value = message
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => {
    error.value = ''
  }, 3000)
}

const handleKeydown = (event: KeyboardEvent): void => {
  // 录制期间吞掉所有按键，避免输入或触发应用内其它快捷键。
  event.preventDefault()
  event.stopPropagation()
  if (event.repeat) return

  if (event.key === 'Escape') {
    stopRecording()
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    emit('update:modelValue', '')
    stopRecording()
    return
  }

  // 单独按下修饰键不算一个组合，继续等待真正的主键。
  const combo = shortcutFromEvent(event)
  if (!combo) return

  // 不带任何修饰键的字母 / 数字 / 标点很容易在日常输入时误触，录制时拒绝（功能键除外）。
  const parsed = parseShortcut(combo)
  if (
    parsed &&
    !parsed.primary &&
    !parsed.cmd &&
    !parsed.alt &&
    !parsed.shift &&
    !/^F\d+$/.test(parsed.key)
  ) {
    return
  }

  const message = props.validate?.(combo) ?? null
  if (message) {
    showError(message)
    stopRecording()
    return
  }

  emit('update:modelValue', combo)
  stopRecording()
}

const startRecording = (): void => {
  stopRecording()
  error.value = ''
  recording.value = true
  keydownHandler = handleKeydown
  window.addEventListener('keydown', handleKeydown, true)
}

onBeforeUnmount(stopRecording)
</script>
