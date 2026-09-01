<template>
  <div v-show="isUpdateModalOpen" class="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-6"
    role="dialog" @mousedown.self="closeUpdateModal">
    <section class="flex max-h-[calc(100vh-3rem)] w-[min(560px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-paper">
      <header class="flex items-start justify-between border-b border-line px-6 py-4">
        <div class="flex min-w-0 flex-col gap-1.5">
          <div class="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2 class="min-w-0 truncate text-[20px] font-semibold tracking-[-0.02em] text-ink">{{ updateInfo?.title }}</h2>
            <span class="flex h-5 shrink-0 items-center rounded border border-line bg-panel px-2 font-mono text-[11px] font-semibold text-secondary">v{{ updateInfo?.version }}</span>
          </div>
          <div class="flex items-center gap-1 text-[12px] text-muted">
            <span>发布于</span>
            <time>{{ formattedReleaseDate }}</time>
          </div>
        </div>
        <button type="button" title="关闭更新窗口" class="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-control-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-60" :disabled="isInstalling" @click="closeUpdateModal">
          <Icon icon="lucide:x" :size="18" />
        </button>
      </header>

      <!-- 更新日志占用弹窗剩余空间，内容过多时仅滚动这一部分。 -->
      <div class="editor-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
        <div class="flex flex-col gap-2">
          <h3 class="text-[13px] font-semibold text-ink">本次更新</h3>
          <div v-for="item in updateInfo?.content" :key="item" class="flex items-start gap-2 text-[13px] leading-6 text-secondary">
            <span class="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-sm bg-ink" />
            <span>{{ item }}</span>
          </div>
        </div>
      </div>

      <!-- 下载状态放在滚动区域之外，更新内容较多时也能始终看到进度。 -->
      <div v-if="isDownloading || downloadedFilePath" class="flex flex-col gap-2.5 border-t border-line bg-panel px-6 py-4">
        <div class="flex items-end justify-between gap-4">
          <div class="flex flex-col gap-1">
            <span class="text-[12px] font-medium text-ink">{{ downloadedFilePath ? '安装包下载完成' : '正在下载安装包' }}</span>
            <span class="font-mono text-[11px] text-muted">{{ downloadedSizeText }} / {{ totalSizeText }} MB</span>
          </div>
          <span class="font-mono text-[13px] font-semibold text-ink">{{ progressPercent }}%</span>
        </div>
        <div class="flex h-1.5 w-full overflow-hidden rounded-full bg-control">
          <div class="flex h-full bg-ink" :style="{ width: `${progressPercent}%` }" />
        </div>
      </div>

      <p v-if="downloadMessage" class="flex border-t border-line bg-panel px-6 py-3 text-[12px] leading-5 text-secondary">{{ downloadMessage }}</p>

      <footer class="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
        <button type="button" class="flex h-9 items-center rounded-md border border-line px-4 text-[13px] text-secondary hover:bg-control-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-60" :disabled="isDownloading || isInstalling" @click="closeUpdateModal">稍后更新</button>
        <button v-if="!downloadedFilePath" type="button" class="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-inverse disabled:cursor-not-allowed disabled:opacity-60" :disabled="isDownloading" @click="downloadUpdate">
          <Icon icon="lucide:download" :size="15" />
          {{ isDownloading ? '下载中…' : '下载更新' }}
        </button>
        <button v-else type="button" class="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-inverse disabled:cursor-not-allowed disabled:opacity-60" :disabled="isInstalling" @click="installUpdate">
          <Icon v-if="isInstalling" icon="lucide:loader-circle" :size="15" />
          {{ isInstalling ? '正在准备安装…' : '立即安装' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue/offline'
import { computed } from 'vue'
import { useUpdater } from '../composables/useUpdater'

const { updateInfo, isUpdateModalOpen, isDownloading, isInstalling, downloadProgress, downloadedFilePath, downloadMessage, closeUpdateModal, downloadUpdate, installUpdate } = useUpdater()

// 下载事件提供的是字节数，界面统一换算成 MB 并保留两位小数。
const bytesToMb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2)

const progressPercent = computed(() => Math.min(100, Math.max(0, downloadProgress.value.percent)))
const downloadedSizeText = computed(() => bytesToMb(downloadProgress.value.receivedBytes))
const totalSizeText = computed(() => bytesToMb(downloadProgress.value.totalBytes))

// 更新弹窗只展示发布日期，不显示具体时分。
const formattedReleaseDate = computed(() => {
  const dateText = updateInfo.value?.date.trim() ?? ''
  return dateText.slice(0, 10)
})
</script>
