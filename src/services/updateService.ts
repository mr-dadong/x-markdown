import type { UpdateDownloadProgress } from "../types/update";

export const updateService = {
  check: () => window.electronAPI.checkForUpdates(),
  getLogs: () => window.electronAPI.getUpdateLogs(),
  download: (url: string) => window.electronAPI.downloadUpdate(url),
  install: (filePath: string) => window.electronAPI.installUpdate(filePath),
  onDownloadProgress: (
    callback: (progress: UpdateDownloadProgress) => void,
  ) => window.electronAPI.onUpdateDownloadProgress(callback),
};
