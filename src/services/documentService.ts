import type { OpenFileData, SaveFileData } from "../types/electron";
import type { IPC_CHANNELS } from "../constants/ipcChannels";

// 文档业务只通过此服务访问桌面端文件能力。
export const documentService = {
  openFiles: () => window.electronAPI.openFile(),
  openDroppedFiles: (filePaths: string[]) =>
    window.electronAPI.openDroppedFiles(filePaths),
  readFile: (filePath: string) => window.electronAPI.readFile(filePath),
  saveFile: (data: SaveFileData) => window.electronAPI.saveFile(data),
  showErrorMessage: (title: string, message: string) =>
    window.electronAPI.showErrorMessage(title, message),
  confirmWindowClose: () => window.electronAPI.confirmWindowClose(),
  confirmExit: (openCount: number, modifiedCount: number) =>
    window.electronAPI.confirmExit(openCount, modifiedCount),
  loadRecoveryDrafts: () => window.electronAPI.loadRecoveryDrafts(),
  saveRecoveryDrafts: (drafts: import("../types/electron").RecoveryDraftData[]) =>
    window.electronAPI.saveRecoveryDrafts(drafts),
  notifyRendererReady: () => window.electronAPI.notifyRendererReady(),
  notifyRendererViewReady: () => window.electronAPI.notifyRendererViewReady(),
  onNewFile: (callback: () => void) =>
    window.electronAPI.onMenuNewFile(callback),
  onOpenFile: (callback: (data: OpenFileData) => void) =>
    window.electronAPI.onMenuOpenFile(callback),
  onSaveFile: (callback: () => void) =>
    window.electronAPI.onMenuSaveFile(callback),
  onSaveAsFile: (callback: () => void) =>
    window.electronAPI.onMenuSaveAsFile(callback),
  onFindReplace: (callback: () => void) =>
    window.electronAPI.onMenuFindReplace(callback),
  onExportHtml: (callback: () => void) =>
    window.electronAPI.onMenuExportHtml(callback),
  onExportPdf: (callback: () => void) =>
    window.electronAPI.onMenuExportPdf(callback),
  onExportZip: (callback: () => void) =>
    window.electronAPI.onMenuExportZip(callback),
  onExportText: (callback: () => void) =>
    window.electronAPI.onMenuExportText(callback),
  onExportDocx: (callback: () => void) =>
    window.electronAPI.onMenuExportDocx(callback),
  onOpenRecentFile: (callback: (filePath: string) => void) =>
    window.electronAPI.onMenuOpenRecentFile(callback),
  onClearRecentFiles: (callback: () => void) =>
    window.electronAPI.onMenuClearRecentFiles(callback),
  onWindowCloseRequest: (callback: () => void) =>
    window.electronAPI.onRequestWindowClose(callback),
  removeListeners: (channel: (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]) =>
    window.electronAPI.removeAllListeners(channel),
};
