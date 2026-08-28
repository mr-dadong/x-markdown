<template>
  <!-- macOS 风格悬浮胶囊：毛玻璃材质，三种状态在容器内平滑切换 -->
  <div class="inline-writer-bar" contenteditable="false">
    <Transition name="inline-writer-fade" mode="out-in">
      <!-- 流式状态：呼吸星光指示进行中，右侧仅保留停止按钮 -->
      <div v-if="isStreaming" key="loading" class="inline-writer-state">
        <Icon icon="lucide:sparkles" :size="14" class="inline-writer-sparkle" />
        <span class="inline-writer-text">{{ actionLabel }}中</span>
        <button type="button" class="inline-writer-stop" title="停止" @mousedown.prevent.stop="$emit('cancel')">
          <Icon icon="lucide:square" :size="11" />
        </button>
      </div>

      <!-- 完成状态：绿色对勾徽标弹入，接受/放弃做成胶囊分段按钮 -->
      <div v-else-if="status === 'done'" key="done" class="inline-writer-state">
        <span class="inline-writer-check">
          <Icon icon="lucide:check" :size="13" />
        </span>
        <span class="inline-writer-text">AI 编写完成</span>
        <div class="inline-writer-actions">
          <button type="button" class="inline-writer-btn inline-writer-btn-primary"
            @mousedown.prevent.stop="$emit('accept')">
            <span>接受</span>
            <kbd class="inline-writer-kbd inline-writer-kbd-light">Tab</kbd>
          </button>
          <button type="button" class="inline-writer-btn inline-writer-btn-ghost"
            @mousedown.prevent.stop="$emit('reject')">
            <span>放弃</span>
            <kbd class="inline-writer-kbd">Esc</kbd>
          </button>
        </div>
      </div>

      <!-- 错误状态：红色警示 + 重试 -->
      <div v-else-if="error" key="error" class="inline-writer-state">
        <Icon icon="lucide:alert-circle" :size="16" class="inline-writer-error-icon" />
        <span class="inline-writer-text inline-writer-error-text" :title="error">{{ error }}</span>
        <button type="button" class="inline-writer-btn inline-writer-btn-primary"
          @mousedown.prevent.stop="$emit('retry')">
          <Icon icon="lucide:rotate-ccw" :size="12" />
          <span>重试</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { AiEditAction } from '../../types/ai'

const props = defineProps<{
  status: 'idle' | 'streaming' | 'done' | 'error'
  error: string
  currentAction: AiEditAction | null
}>()

defineEmits<{
  accept: []
  reject: []
  cancel: []
  retry: []
}>()

const isStreaming = computed(() => props.status === 'streaming')

const actionLabels: Record<AiEditAction, string> = {
  polish: '润色',
  rewrite: '重写',
  summarize: '总结',
  translate: '翻译',
  continue: '续写',
  'explain-code': '解释代码',
  'fix-code': '修复代码',
  outline: '生成大纲',
  toc: '生成目录',
  table: '生成表格',
  callout: '生成提示框',
  mermaid: '生成图表',
  frontmatter: '生成元数据',
  'ai-write': 'AI 实时编写',
}

const actionLabel = computed(() => {
  return props.currentAction ? actionLabels[props.currentAction] : 'AI 编写'
})
</script>

<style scoped>
/* ===== 毛玻璃胶囊容器 ===== */
/* 半透明底 + 背景模糊模拟 macOS 系统材质，柔和多层阴影营造悬浮感 */
.inline-writer-bar {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 8px 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.06),
    0 2px 8px rgba(0, 0, 0, 0.08),
    0 12px 32px rgba(0, 0, 0, 0.12);
  font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif;
  max-width: 100%;
  pointer-events: auto;
}

:root.dark .inline-writer-bar {
  background: rgba(44, 44, 48, 0.66);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.45),
    0 2px 8px rgba(0, 0, 0, 0.3),
    0 12px 32px rgba(0, 0, 0, 0.45);
}

.inline-writer-state {
  display: flex;
  align-items: center;
  gap: 9px;
}

.inline-writer-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-ink);
  white-space: nowrap;
}

/* AI 星光：书写期间轻柔呼吸，兼任"进行中"指示 */
.inline-writer-sparkle {
  color: var(--color-accent);
  flex-shrink: 0;
  animation: inline-writer-sparkle-pulse 1.6s ease-in-out infinite;
}

@keyframes inline-writer-sparkle-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.75;
  }
  50% {
    transform: scale(1.18);
    opacity: 1;
  }
}

/* 停止按钮：悬停变红提示可终止 */
.inline-writer-stop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: none;
  background: rgba(120, 120, 128, 0.16);
  color: var(--color-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.15s ease, color 0.15s ease, transform 0.12s ease;
}

.inline-writer-stop:hover {
  background: #ff3b30;
  color: #fff;
}

.inline-writer-stop:active {
  transform: scale(0.92);
}

:root.dark .inline-writer-stop:hover {
  background: #ff453a;
}

/* ===== 完成状态：对勾徽标弹簧入场 ===== */
.inline-writer-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #34c759;
  color: #fff;
  flex-shrink: 0;
  animation: inline-writer-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}

:root.dark .inline-writer-check {
  background: #30d158;
}

@keyframes inline-writer-pop {
  0% {
    transform: scale(0.3);
    opacity: 0;
  }
  70% {
    transform: scale(1.12);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.inline-writer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ===== 胶囊按钮 ===== */
.inline-writer-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: none;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, transform 0.12s ease, filter 0.15s ease;
}

.inline-writer-btn:active {
  transform: scale(0.95);
}

.inline-writer-btn-primary {
  background: var(--color-accent);
  color: #fff;
}

.inline-writer-btn-primary:hover {
  filter: brightness(1.08);
}

.inline-writer-btn-ghost {
  background: rgba(120, 120, 128, 0.16);
  color: var(--color-ink);
}

.inline-writer-btn-ghost:hover {
  background: rgba(120, 120, 128, 0.26);
}

/* ===== 错误状态 ===== */
.inline-writer-error-icon {
  color: #ff3b30;
  flex-shrink: 0;
}

:root.dark .inline-writer-error-icon {
  color: #ff453a;
}

.inline-writer-error-text {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-danger);
}

/* ===== 按键提示 ===== */
.inline-writer-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 16px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-family: inherit;
  background: rgba(120, 120, 128, 0.18);
  color: var(--color-muted);
}

.inline-writer-kbd-light {
  background: rgba(255, 255, 255, 0.28);
  color: rgba(255, 255, 255, 0.92);
}

/* ===== 状态切换过渡 ===== */
.inline-writer-fade-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.inline-writer-fade-leave-active {
  transition: all 0.12s ease-in;
}

.inline-writer-fade-enter-from {
  opacity: 0;
  transform: translateY(5px) scale(0.97);
}

.inline-writer-fade-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.98);
}
</style>
