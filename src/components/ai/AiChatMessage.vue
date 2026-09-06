<template>
  <!-- 消息行：用户消息右对齐，AI 与系统消息左对齐 -->
  <div class="flex flex-col px-3" :class="message.role === 'user' ? 'items-end' : 'items-start'">
    <!-- 用户消息：实心深色气泡，右下角留小圆角模拟消息指向 -->
    <div v-if="message.role === 'user'" class="flex min-w-0 max-w-[85%] flex-col items-end gap-1.5">
      <div class="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13px] leading-relaxed text-inverse">{{ message.content }}</div>
      <!-- 历史引用默认折叠，按需查看发送时保存的正文快照。 -->
      <div v-if="message.references?.length" class="flex w-full min-w-0 flex-col items-end gap-1.5">
        <button
          type="button"
          class="flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-[11px] text-muted hover:bg-toolbar hover:text-ink"
          :aria-expanded="referencesOpen"
          @click="referencesOpen = !referencesOpen"
        >
          <Icon :icon="referencesOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'" :size="12" />
          <span>引用了 {{ message.references.length }} 处正文</span>
        </button>
        <div v-if="referencesOpen" class="flex max-h-64 w-full flex-col gap-3 overflow-y-auto rounded-lg border border-line bg-panel p-2.5">
          <div v-for="(reference, index) in message.references" :key="index" class="flex min-w-0 flex-col gap-1">
            <span class="text-[11px] text-muted">引用 {{ index + 1 }} · {{ reference.length }} 字符</span>
            <div class="whitespace-pre-wrap break-words text-[12px] leading-5 text-secondary">{{ reference }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI 回复：柔和灰底无边框气泡，内容更轻 -->
    <div v-else-if="message.role === 'assistant'" class="w-full rounded-2xl rounded-bl-md bg-toolbar px-3.5 py-2.5">
      <!-- AI 小标识：仅用图标加文字，避免灰块徽章的笨重感 -->
      <div class="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted">
        <Icon icon="lucide:sparkles" :size="12" class="text-accent" />
        <span>AI</span>
      </div>
      <AiChatReasoning v-if="message.reasoning" :content="message.reasoning" />
      <AiMarkdown :markdown="message.content" />
      <AiChatMessageActions
        :message-id="message.id"
        :is-streaming="isStreaming"
        @insert="$emit('insert', message.id)"
        @copy="$emit('copy', message.id)"
        @retry="$emit('retry')"
      />
    </div>

    <!-- 系统消息：居中的弱化提示行 -->
    <div
      v-else-if="message.role === 'system'"
      class="flex w-full items-center justify-center gap-1.5 py-1 text-[11px] text-muted"
    >
      <Icon icon="lucide:info" :size="12" class="shrink-0 opacity-60" />
      <span>{{ message.content }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { AiChatMessage } from '../../types/ai'
import AiChatMessageActions from './AiChatMessageActions.vue'
import AiChatReasoning from './AiChatReasoning.vue'
import AiMarkdown from './AiMarkdown.vue'

// 每条消息单独记录展开状态，不把界面状态写入对话历史。
const referencesOpen = ref(false)

defineProps<{
  message: AiChatMessage
  isStreaming?: boolean
}>()

defineEmits<{
  insert: [messageId: string]
  copy: [messageId: string]
  retry: []
}>()
</script>
