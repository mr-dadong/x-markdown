import type { UpdateDownloadProgress } from "../types/update";

export const updateService = {
  check: () => window.electronAPI.checkForUpdates(),
  getLogs: () => window.electronAPI.getUpdateLogs(),
  download: () => window.electronAPI.downloadUpdate(),
  install: () => window.electronAPI.installUpdate(),
  onDownloadProgress: (
    callback: (progress: UpdateDownloadProgress) => void,
  ) => window.electronAPI.onUpdateDownloadProgress(callback),
};
