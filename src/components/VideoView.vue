<template>
  <node-view-wrapper
    contenteditable="false"
    data-xmd-video
    class="group relative my-6 flex w-full overflow-hidden rounded-lg bg-[#1f2023]"
    @mouseleave="speedMenuVisible = false"
  >
    <video
      ref="videoElement"
      class="max-h-[480px] w-full bg-[#1f2023]"
      preload="metadata"
      @click="togglePlayback"
      @loadedmetadata="syncVideoState"
      @timeupdate="syncVideoState"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
    />

    <!-- 控制栏与编辑器共用克制的黑白灰风格，不使用浏览器自带的异形菜单。 -->
    <div class="absolute inset-x-0 bottom-0 flex flex-col bg-[rgba(20,20,22,0.88)] px-3 pb-2 pt-2">
      <div
        ref="progressElement"
        class="flex h-4 cursor-pointer items-center"
        title="拖动调整播放进度"
        @pointerdown="startSeeking"
      >
        <div class="flex h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.28)]">
          <div class="flex h-full bg-white" :style="{ width: `${progressPercent}%` }" />
        </div>
      </div>

      <div class="flex h-7 items-center justify-between text-white">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex h-7 w-7 items-center justify-center rounded text-base hover:bg-[rgba(255,255,255,0.14)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-white"
            :title="playing ? '暂停' : '播放'"
            @click.stop="togglePlayback"
          >
            {{ playing ? 'Ⅱ' : '▶' }}
          </button>
          <span class="font-mono text-[11px] tabular-nums text-[#e5e7eb]">
            {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
          </span>
        </div>

        <div class="relative flex">
          <button
            type="button"
            class="flex h-7 min-w-[46px] items-center justify-center rounded px-2 font-mono text-[11px] hover:bg-[rgba(255,255,255,0.14)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-white"
            title="播放速度"
            @click.stop="speedMenuVisible = !speedMenuVisible"
          >
            {{ playbackRate }}×
          </button>
          <div
            v-if="speedMenuVisible"
            class="absolute bottom-9 right-0 flex w-20 flex-col overflow-hidden rounded-md border border-[#494b50] bg-[#292a2e] p-1"
          >
            <button
              v-for="rate in playbackRates"
              :key="rate"
              type="button"
              class="flex h-8 items-center justify-center rounded font-mono text-[11px] text-[#e4e6eb] hover:bg-[#3a3b40]"
              :class="{ 'bg-[#45464c] text-white': rate === playbackRate }"
              @click.stop="setPlaybackRate(rate)"
            >
              {{ rate }}×
            </button>
          </div>
        </div>
      </div>
    </div>
  </node-view-wrapper>
</template>

<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { mediaService } from '../services/mediaService'

const props = defineProps<NodeViewProps>()
const videoElement = ref<HTMLVideoElement | null>(null)
const progressElement = ref<HTMLElement | null>(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const playbackRate = ref(1)
const speedMenuVisible = ref(false)
const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2]
const progressPercent = computed(() => duration.value > 0
  ? Math.min(100, Math.max(0, currentTime.value / duration.value * 100))
  : 0)

const getCurrentDocumentPath = (): string | null => {
  const options = props.extension.options as { getCurrentDocumentPath?: () => string | null }
  return options.getCurrentDocumentPath?.() ?? null
}

const loadVideo = async (source: string): Promise<void> => {
  const video = videoElement.value
  if (!video) return
  video.removeAttribute('src')
  video.load()
  video.src = await mediaService.resolveVideo(source, getCurrentDocumentPath())
  video.load()
}

const syncVideoState = (): void => {
  const video = videoElement.value
  if (!video) return
  currentTime.value = Number.isFinite(video.currentTime) ? video.currentTime : 0
  duration.value = Number.isFinite(video.duration) ? video.duration : 0
}

const togglePlayback = (): void => {
  const video = videoElement.value
  if (!video) return
  if (video.paused) void video.play()
  else video.pause()
}

const seekAtPointer = (event: PointerEvent): void => {
  const video = videoElement.value
  const progress = progressElement.value
  if (!video || !progress || !Number.isFinite(video.duration)) return
  const bounds = progress.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
  // 拖动时立即更新 currentTime，让画面与进度位置同步，而不是等松手后再跳转。
  video.currentTime = ratio * video.duration
  syncVideoState()
}

const stopSeeking = (): void => {
  window.removeEventListener('pointermove', seekAtPointer)
  window.removeEventListener('pointerup', stopSeeking)
  window.removeEventListener('pointercancel', stopSeeking)
}

const startSeeking = (event: PointerEvent): void => {
  event.preventDefault()
  seekAtPointer(event)
  window.addEventListener('pointermove', seekAtPointer)
  window.addEventListener('pointerup', stopSeeking)
  window.addEventListener('pointercancel', stopSeeking)
}

const setPlaybackRate = (rate: number): void => {
  playbackRate.value = rate
  if (videoElement.value) videoElement.value.playbackRate = rate
  speedMenuVisible.value = false
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '00:00'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

onMounted(() => void loadVideo(String(props.node.attrs.src)))
watch(() => props.node.attrs.src, (source) => void loadVideo(String(source)))
onBeforeUnmount(stopSeeking)
</script>
