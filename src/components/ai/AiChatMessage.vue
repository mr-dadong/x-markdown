<template>
  <!-- 消息行：用户消息右对齐，AI 与系统消息左对齐 -->
  <div class="flex flex-col px-3" :class="message.role === 'user' ? 'items-end' : 'items-start'">
    <!-- 用户消息：实心深色气泡，右下角留小圆角模拟消息指向 -->
    <div v-if="message.role === 'user'" class="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2">
      <div class="whitespace-pre-wrap text-[13px] leading-relaxed text-inverse">{{ message.content }}</div>
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
import { Icon } from '@iconify/vue/offline'
import type { AiChatMessage } from '../../types/ai'
import AiChatMessageActions from './AiChatMessageActions.vue'
import AiChatReasoning from './AiChatReasoning.vue'
import AiMarkdown from './AiMarkdown.vue'

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
