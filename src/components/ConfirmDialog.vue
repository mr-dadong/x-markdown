<template>
  <div
    v-if="dialogState"
    class="fixed inset-0 z-[150] flex items-center justify-center bg-black/35 p-6"
    role="dialog"
    @mousedown.self="cancel"
  >
    <section
      class="flex w-[min(400px,92vw)] flex-col overflow-hidden rounded-lg border border-line bg-paper"
      @keydown.esc.prevent="cancel"
      @keydown.enter.prevent="confirm"
    >
      <header class="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel text-muted">
          <Icon :icon="dialogState.tone === 'danger' ? 'lucide:alert-triangle' : 'lucide:file-warning'" :size="15" />
        </div>
        <h2 class="min-w-0 text-[14px] font-semibold tracking-tight text-ink">{{ dialogState.title }}</h2>
      </header>

      <div class="flex px-5 py-4">
        <p class="whitespace-pre-line text-[12px] leading-5 text-secondary">{{ dialogState.message }}</p>
      </div>

      <footer class="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <button
          ref="cancelButton"
          type="button"
          class="flex h-8 items-center justify-center rounded-md border border-line px-3 text-[12px] font-medium text-secondary hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @click="cancel"
        >
          {{ dialogState.cancelLabel }}
        </button>
        <button
          type="button"
          class="flex h-8 items-center justify-center rounded-md bg-accent px-3 text-[12px] font-semibold text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          @click="confirm"
        >
          {{ dialogState.confirmLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { useConfirmDialog } from '../composables/useConfirmDialog'

const cancelButton = ref<HTMLButtonElement | null>(null)
const { dialogState, confirm, cancel } = useConfirmDialog()

// 默认聚焦“取消”，按回车前仍保留一次明确选择，降低误丢内容的风险。
watch(dialogState, async (state) => {
  if (!state) return
  await nextTick()
  cancelButton.value?.focus()
})
</script>
