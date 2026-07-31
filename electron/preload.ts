import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApplicationMenuPosition,
  AttachmentCopyProgress,
  ElectronAPI,
  ImportEditorFileOptions,
  IpcChannel,
  OpenFileData,
  SaveFileData,
  SaveFileResult,
  SelectEditorFileOptions,
} from '../src/types/electron'
import type { UpdateDownloadProgress } from '../src/types/update'
import { IPC_CHANNELS } from '../src/constants/ipcChannels'

const electronAPI: ElectronAPI = {
  openFile: (): Promise<OpenFileData[] | null> => ipcRenderer.invoke(IPC_CHANNELS.openFile),

  getUpdateLogs: (): Promise<import('../src/types/update').UpdateLogsResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.getUpdateLogs)
  },

  saveFile: (data: SaveFileData): Promise<SaveFileResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.saveFile, data)
  },

  showErrorMessage: (title: string, message: string): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.showErrorMessage, { title, message })
  },

  minimizeWindow: () => {
    ipcRenderer.send(IPC_CHANNELS.windowMinimize)
  },

  maximizeWindow: () => {
    ipcRenderer.send(IPC_CHANNELS.windowMaximize)
  },

  closeWindow: () => {
    ipcRenderer.send(IPC_CHANNELS.windowClose)
  },

  confirmWindowClose: () => {
    ipcRenderer.send(IPC_CHANNELS.confirmWindowClose)
  },

  onRequestWindowClose: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.requestWindowClose, callback)
  },

  showApplicationMenu: (position: ApplicationMenuPosition): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.showApplicationMenu, position)
  },

  notifyRendererReady: () => {
    ipcRenderer.send(IPC_CHANNELS.rendererReady)
  },

  onMenuNewFile: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuNewFile, () => callback())
  },

  onMenuOpenFile: (callback: (data: OpenFileData) => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuOpenFile, (_event, data: OpenFileData) => callback(data))
  },

  onMenuSaveFile: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuSaveFile, () => callback())
  },

  onMenuSaveAsFile: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuSaveAsFile, () => callback())
  },

  removeAllListeners: (channel: IpcChannel) => {
    ipcRenderer.removeAllListeners(channel)
  },

  // 文件系统 API
  readDirectory: (dirPath: string): Promise<{ name: string; isDirectory: boolean; path: string }[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.readDirectory, dirPath)
  },

  readFile: (filePath: string): Promise<{ success: boolean; content?: string; modifiedTime?: number; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.readFile, filePath)
  },

  getDirectoryName: (filePath: string): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.getDirectoryName, filePath)
  },

  selectEditorFile: (
    options: SelectEditorFileOptions,
  ): Promise<{ fileName: string; fileSize: number; fileType: string; url: string } | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.selectEditorFile, options)
  },

  importEditorFile: (options: ImportEditorFileOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.importEditorFile, options),

  onAttachmentCopyProgress: (callback: (progress: AttachmentCopyProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: AttachmentCopyProgress): void => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.attachmentCopyProgress, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.attachmentCopyProgress, listener)
  },

  saveEditorImage: (
    bytes: Uint8Array,
    mimeType: string,
    currentDocumentPath: string | null,
  ): Promise<{ fileName: string; fileSize: number; fileType: string; url: string } | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.saveEditorImage, { bytes, mimeType, currentDocumentPath }),

  readEditorImage: (url: string, currentDocumentPath: string | null): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.readEditorImage, { url, currentDocumentPath }),

  resolveEditorVideo: (url: string, currentDocumentPath: string | null): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.resolveEditorVideo, { url, currentDocumentPath }),

  openEditorFile: (url: string, currentDocumentPath: string | null): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.openEditorFile, { url, currentDocumentPath }),

  openLocalLink: (url: string, currentDocumentPath: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.openLocalLink, { url, currentDocumentPath }),

  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),

  openExternalLink: (url: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.openExternalLink, url),

  downloadUpdate: (updateUrl: string) => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate, updateUrl),

  installUpdate: (filePath: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.installUpdate, filePath),

  onUpdateDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => {
    ipcRenderer.on(IPC_CHANNELS.updateDownloadProgress, (_event, progress: UpdateDownloadProgress) => callback(progress))
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
