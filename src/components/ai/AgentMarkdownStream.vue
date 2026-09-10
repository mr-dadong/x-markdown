<template>
  <!-- 流式 Markdown：已完成块节点复用不重建，尾段实时渲染出排版效果。 -->
  <AiMarkdown ref="markdownRef">
    <div v-for="block in blocks" :key="block.id" class="ai-md-block" v-html="block.html" />
    <div v-if="tail" class="ai-md-tail" v-html="tail" />
  </AiMarkdown>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { normalizeAiMarkdown } from '../../utils/aiMarkdown'
import { splitStreamBlocks, type StreamBlock } from '../../utils/streamBlocks'
import AiMarkdown from './AiMarkdown.vue'

const props = defineProps<{ text: string }>()

const markdownRef = ref<InstanceType<typeof AiMarkdown> | null>(null)
const blocks = ref<StreamBlock[]>([])
const tail = ref('')
let nextBlockId = 0

// 增量补块：新完成的块只渲染一次，尾段每次增量都重新渲染成样式。
const sync = (): void => {
  const text = props.text
  if (!text) {
    blocks.value = []
    tail.value = ''
    nextBlockId = 0
    return
  }
  const { done, tail: tailText } = splitStreamBlocks(normalizeAiMarkdown(text))
  for (let i = blocks.value.length; i < done.length; i++) {
    blocks.value.push({ id: nextBlockId++, html: markdownRef.value?.render(done[i]) ?? '' })
  }
  tail.value = markdownRef.value?.renderTail(tailText) ?? ''
}

// flush: post 保证渲染器组件已挂载、ref 可用后再补块。
watch(() => props.text, sync, { flush: 'post' })
onMounted(sync)
</script>
