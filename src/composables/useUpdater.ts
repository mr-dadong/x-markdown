import { computed, ref } from 'vue'
import type { UpdateDownloadProgress, UpdateInfo } from '../types/update'
import { updateService } from '../services/updateService'

const updateInfo = ref<UpdateInfo | null>(null)
const isUpdateModalOpen = ref(false)
const isChecking = ref(false)
const checkMessage = ref('')
const isDownloading = ref(false)
const downloadProgress = ref<UpdateDownloadProgress>({ percent: 0, receivedBytes: 0, totalBytes: 0 })
const downloadedFilePath = ref<string | null>(null)
const downloadMessage = ref('')
let progressListenerRegistered = false

export function useUpdater() {
  const hasUpdate = computed(() => updateInfo.value !== null)

  // 主动检查和首次启动检查共用同一份状态，保证头部按钮与设置页结果同步。
  const checkForUpdates = async (manual = false): Promise<void> => {
    if (isChecking.value) return
    isChecking.value = true
    if (manual) checkMessage.value = '正在检查更新…'

    try {
      const result = await updateService.check()
      updateInfo.value = result.hasUpdate ? result.update : null
      if (manual) {
        checkMessage.value = result.hasUpdate ? `发现新版本 v${result.update?.version}` : `当前已是最新版本 v${result.currentVersion}`
        if (result.hasUpdate) isUpdateModalOpen.value = true
      }
    } catch (error) {
      if (manual) checkMessage.value = error instanceof Error ? error.message : '检查更新失败，请稍后重试'
    } finally {
      isChecking.value = false
    }
  }

  const openUpdateModal = (): void => {
    if (updateInfo.value) isUpdateModalOpen.value = true
  }

  const closeUpdateModal = (): void => {
    if (!isDownloading.value) isUpdateModalOpen.value = false
  }

  const downloadUpdate = async (): Promise<void> => {
    if (!updateInfo.value || isDownloading.value) return
    isDownloading.value = true
    downloadedFilePath.value = null
    downloadMessage.value = ''
    downloadProgress.value = { percent: 0, receivedBytes: 0, totalBytes: 0 }

    try {
      // 主进程已经按照当前系统与 CPU 架构选出了唯一匹配的安装包。
      const result = await updateService.download()
      if (result.status === 'downloaded' && result.filePath) downloadedFilePath.value = result.filePath
      if (result.status === 'external') downloadMessage.value = '已打开夸克网盘，请在浏览器中下载安装包。'
    } catch (error) {
      downloadMessage.value = error instanceof Error ? error.message : '下载失败，请稍后重试'
    } finally {
      isDownloading.value = false
    }
  }

  const installUpdate = async (): Promise<void> => {
    if (downloadedFilePath.value) await updateService.install()
  }

  if (!progressListenerRegistered) {
    progressListenerRegistered = true
    updateService.onDownloadProgress((progress) => {
      downloadProgress.value = progress
    })
  }

  return {
    updateInfo,
    hasUpdate,
    isUpdateModalOpen,
    isChecking,
    checkMessage,
    isDownloading,
    downloadProgress,
    downloadedFilePath,
    downloadMessage,
    checkForUpdates,
    openUpdateModal,
    closeUpdateModal,
    downloadUpdate,
    installUpdate,
  }
}
