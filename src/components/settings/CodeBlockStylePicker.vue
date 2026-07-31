<template>
  <div class="flex w-[340px] flex-wrap justify-end gap-2.5">
    <button
      v-for="style in codeBlockStyles"
      :key="style.id"
      type="button"
      :title="style.description"
      class="flex w-[162px] flex-col gap-2 rounded-lg border p-2.5 text-left outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      :class="modelValue === style.id ? 'border-accent bg-selected' : 'border-line bg-panel hover:border-muted'"
      @click="emit('update:modelValue', style.id)"
    >
      <!-- 预览仅使用简单色块，避免在设置页面重复创建真实编辑器实例。 -->
      <span class="flex h-14 w-full flex-col overflow-hidden rounded border border-black/10">
        <span class="flex h-4 shrink-0 items-center gap-1 px-1.5" :class="style.previewHeaderClass">
          <span class="h-1.5 w-1.5 rounded-full bg-[#ff5f57]" />
          <span class="h-1.5 w-1.5 rounded-full bg-[#febc2e]" />
          <span class="h-1.5 w-1.5 rounded-full bg-[#28c840]" />
        </span>
        <span class="flex flex-1 flex-col justify-center gap-1.5 px-2" :class="style.previewBodyClass">
          <span
            v-for="(lineClass, index) in style.previewLineClasses"
            :key="lineClass"
            class="h-1 rounded-full opacity-80"
            :class="[lineClass, index === 1 ? 'w-3/4' : index === 2 ? 'w-1/2' : 'w-5/6']"
          />
        </span>
      </span>
      <span class="flex items-center justify-between text-[12px] font-medium text-ink">
        {{ style.name }}
        <Icon v-if="modelValue === style.id" icon="lucide:check" :size="13" />
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'
import { codeBlockStyles, type CodeBlockStyleId } from '../../modules/codeBlockStyles'

defineProps<{ modelValue: CodeBlockStyleId }>()
const emit = defineEmits<{ 'update:modelValue': [value: CodeBlockStyleId] }>()
</script>
