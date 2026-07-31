<template>
  <div
    class="fixed z-50 flex w-[320px] flex-col gap-2.5 rounded-lg border border-line bg-paper p-2.5"
    :style="position"
    contenteditable="false"
    @mousedown.stop
  >
    <div class="flex h-7 items-center justify-between px-1">
      <span class="flex items-center gap-2 text-[12px] font-semibold text-ink">
        <Icon icon="lucide:link-2" :size="15" class="text-link" />
        插入超链接
      </span>
      <span class="font-mono text-[10px] text-muted/60">ESC</span>
    </div>
    <div class="flex flex-col overflow-hidden rounded-md border border-line bg-toolbar">
      <label class="flex h-9 items-center gap-2 px-2.5 focus-within:bg-paper">
        <span class="w-10 shrink-0 text-[11px] text-muted">地址</span>
        <input
          ref="urlInput"
          :value="url"
          type="url"
          placeholder="https://example.com"
          class="h-full min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-muted/50"
          @input="updateUrl"
          @keydown.esc.prevent="$emit('cancel')"
          @keydown.enter.prevent="labelInput?.focus()"
        >
      </label>
      <span class="mx-2.5 h-px bg-line" />
      <label class="flex h-9 items-center gap-2 px-2.5 focus-within:bg-paper">
        <span class="w-10 shrink-0 text-[11px] text-muted">文字</span>
        <input
          ref="labelInput"
          :value="label"
          type="text"
          placeholder="链接显示名称"
          class="h-full min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-muted/50"
          @input="updateLabel"
          @keydown.esc.prevent="$emit('cancel')"
          @keydown.enter.prevent="$emit('submit')"
        >
      </label>
    </div>
    <span v-if="error" class="px-1 text-[11px] text-danger">{{ error }}</span>
    <div class="flex h-8 items-center justify-end gap-1">
      <button
        type="button"
        class="flex h-7 items-center rounded-md px-2.5 text-[11px] text-muted hover:bg-control-hover hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @mousedown.prevent="$emit('cancel')"
      >
        取消
      </button>
      <button
        type="button"
        class="flex h-7 items-center rounded-md bg-ink px-3 text-[11px] font-medium text-inverse hover:bg-accent-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        @mousedown.prevent="$emit('submit')"
      >
        插入
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from "@iconify/vue/offline";
import { onMounted, ref } from "vue";

defineProps<{
  url: string;
  label: string;
  error: string;
  position: Record<string, string>;
}>();

const emit = defineEmits<{
  "update:url": [value: string];
  "update:label": [value: string];
  cancel: [];
  submit: [];
}>();

const urlInput = ref<HTMLInputElement | null>(null);
const labelInput = ref<HTMLInputElement | null>(null);

// 面板出现后直接进入地址输入框，保留原有的键盘操作体验。
onMounted(() => urlInput.value?.focus());

const updateUrl = (event: Event): void => {
  emit("update:url", (event.target as HTMLInputElement).value);
};

const updateLabel = (event: Event): void => {
  emit("update:label", (event.target as HTMLInputElement).value);
};
</script>
