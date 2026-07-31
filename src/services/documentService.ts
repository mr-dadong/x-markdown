import type { OpenFileData, SaveFileData } from "../types/electron";
import type { IPC_CHANNELS } from "../constants/ipcChannels";

// 文档业务只通过此服务访问桌面端文件能力。
export const documentService = {
  openFiles: () => window.electronAPI.openFile(),
  readFile: (filePath: string) => window.electronAPI.readFile(filePath),
  saveFile: (data: SaveFileData) => window.electronAPI.saveFile(data),
  showErrorMessage: (title: string, message: string) =>
    window.electronAPI.showErrorMessage(title, message),
  confirmWindowClose: () => window.electronAPI.confirmWindowClose(),
  notifyRendererReady: () => window.electronAPI.notifyRendererReady(),
  onNewFile: (callback: () => void) =>
    window.electronAPI.onMenuNewFile(callback),
  onOpenFile: (callback: (data: OpenFileData) => void) =>
    window.electronAPI.onMenuOpenFile(callback),
  onSaveFile: (callback: () => void) =>
    window.electronAPI.onMenuSaveFile(callback),
  onSaveAsFile: (callback: () => void) =>
    window.electronAPI.onMenuSaveAsFile(callback),
  onWindowCloseRequest: (callback: () => void) =>
    window.electronAPI.onRequestWindowClose(callback),
  removeListeners: (channel: (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]) =>
    window.electronAPI.removeAllListeners(channel),
};
