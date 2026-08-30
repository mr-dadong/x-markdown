import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ApplicationMenuPosition,
  AttachmentCopyProgress,
  ElectronAPI,
  ExportDocxData,
  ExportHtmlData,
  ExportImageData,
  ExportTextData,
  ExportZipData,
  ImportEditorFileOptions,
  IpcChannel,
  OpenFileData,
  RecoveryDraftData,
  RendererDiagnosticEvent,
  SaveFileData,
  SaveFileResult,
  SelectEditorFileOptions,
} from '../src/types/electron'
import type { UpdateDownloadProgress } from '../src/types/update'
import type {
  AiChatDeltaEvent,
  AiChatDoneEvent,
  AiChatErrorEvent,
  AiChatRequest,
  AiDeltaEvent,
  AiDoneEvent,
  AiErrorEvent,
  AiFetchModelsResult,
  AiInvokeRequest,
  AiSettingsInput,
} from '../src/types/ai'
import { IPC_CHANNELS } from '../src/constants/ipcChannels'

const electronAPI: ElectronAPI = {
  aiService: {
    getSettings: (): Promise<import('../src/types/ai').AiPublicSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.aiGetSettings),

    saveSettings: (settings: AiSettingsInput) =>
      ipcRenderer.invoke(IPC_CHANNELS.aiSaveSettings, settings),

    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.aiGetStatus),

    fetchModels: (): Promise<AiFetchModelsResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.aiFetchModels),

    fetchModelsWithDraft: (draft: AiSettingsInput): Promise<AiFetchModelsResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.aiFetchModelsWithDraft, draft),

    testConnection: (): Promise<import('../src/types/ai').AiTestConnectionResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.aiTestConnection),

    testConnectionWithDraft: (
      draft: AiSettingsInput,
    ): Promise<import('../src/types/ai').AiTestConnectionResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.aiTestConnectionWithDraft, draft),

    invoke: (request: AiInvokeRequest) => ipcRenderer.invoke(IPC_CHANNELS.aiInvoke, request),

    cancel: (requestId: string): void => {
      ipcRenderer.send(IPC_CHANNELS.aiCancel, requestId)
    },

    onDelta: (callback: (event: AiDeltaEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AiDeltaEvent): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.aiStreamDelta, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.aiStreamDelta, listener)
    },

    onDone: (callback: (event: AiDoneEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AiDoneEvent): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.aiStreamDone, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.aiStreamDone, listener)
    },

    onError: (callback: (event: AiErrorEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AiErrorEvent): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.aiStreamError, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.aiStreamError, listener)
    },

    // Chat 多轮对话
    chatInvoke: (request: AiChatRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.aiChatInvoke, request),

    chatCancel: (requestId: string): void => {
      ipcRenderer.send(IPC_CHANNELS.aiChatCancel, requestId)
    },

    onChatDelta: (callback: (event: AiChatDeltaEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AiChatDeltaEvent): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.aiChatStreamDelta, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.aiChatStreamDelta, listener)
    },

    onChatDone: (callback: (event: AiChatDoneEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AiChatDoneEvent): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.aiChatStreamDone, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.aiChatStreamDone, listener)
    },

    onChatError: (callback: (event: AiChatErrorEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AiChatErrorEvent): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.aiChatStreamError, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.aiChatStreamError, listener)
    },
  },
  // Electron 32 起不再向 File 暴露 path，统一通过官方接口取得系统文件路径。
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  openFile: (): Promise<OpenFileData[] | null> => ipcRenderer.invoke(IPC_CHANNELS.openFile),

  openDroppedFiles: (filePaths: string[]): Promise<OpenFileData[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.openDroppedFiles, filePaths),

  getUpdateLogs: (): Promise<import('../src/types/update').UpdateLogsResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.getUpdateLogs)
  },

  saveFile: (data: SaveFileData): Promise<SaveFileResult> => {
    return ipcRenderer.invoke(IPC_CHANNELS.saveFile, data)
  },

  updateShortcuts: (shortcuts: Record<string, string>): void => {
    ipcRenderer.send(IPC_CHANNELS.updateShortcuts, shortcuts)
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

  notifyRendererReady: (): Promise<OpenFileData[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.rendererReady),

  notifyRendererViewReady: () => {
    ipcRenderer.send(IPC_CHANNELS.rendererViewReady)
  },

  logRendererDiagnostic: (event: RendererDiagnosticEvent): void => {
    ipcRenderer.send(IPC_CHANNELS.rendererDiagnostic, event)
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

  onMenuFindReplace: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuFindReplace, () => callback())
  },

  onMenuExportHtml: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuExportHtml, () => callback())
  },

  onMenuExportPdf: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuExportPdf, () => callback())
  },

  onMenuExportZip: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuExportZip, () => callback())
  },

  onMenuExportText: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuExportText, () => callback())
  },

  onMenuExportDocx: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuExportDocx, () => callback())
  },

  onMenuExportImage: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuExportImage, () => callback())
  },

  onMenuOpenRecentFile: (callback: (filePath: string) => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuOpenRecentFile, (_event, filePath: string) => callback(filePath))
  },

  onMenuClearRecentFiles: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.menuClearRecentFiles, () => callback())
  },

  getRecentFiles: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.recentFilesList),

  addRecentFiles: (filePaths: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.recentFilesAdd, filePaths),

  removeRecentFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.recentFilesRemove, filePath),

  clearRecentFiles: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.recentFilesClear),

  removeAllListeners: (channel: IpcChannel) => {
    ipcRenderer.removeAllListeners(channel)
  },

  // 文件系统 API
  readDirectory: (dirPath: string): Promise<{ name: string; isDirectory: boolean; path: string }[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.readDirectory, dirPath)
  },

  createFileTreeEntry: (parentPath: string, name: string, isDirectory: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.createFileTreeEntry, { parentPath, name, isDirectory }),
  renameFileTreeEntry: (entryPath: string, newName: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.renameFileTreeEntry, { entryPath, newName }),
  deleteFileTreeEntry: (entryPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteFileTreeEntry, entryPath),
  copyFileTreePath: (entryPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.copyFileTreePath, entryPath),
  showFileTreeEntry: (entryPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.showFileTreeEntry, entryPath),

  selectWorkspace: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.selectWorkspace),
  getWorkspace: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.getWorkspace),

  watchWorkspace: (directoryPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.watchWorkspace, directoryPath),

  unwatchWorkspace: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.unwatchWorkspace),

  onWorkspaceChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.workspaceChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceChanged, listener)
  },

  confirmExit: (openCount: number, modifiedCount: number): Promise<'save' | 'discard' | 'cancel'> =>
    ipcRenderer.invoke(IPC_CHANNELS.confirmExit, { openCount, modifiedCount }),

  loadRecoveryDrafts: (): Promise<RecoveryDraftData[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.loadRecoveryDrafts),

  saveRecoveryDrafts: (drafts: RecoveryDraftData[]): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.saveRecoveryDrafts, drafts),

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

  readEditorFileBytes: (url: string, currentDocumentPath: string | null): Promise<Uint8Array> =>
    ipcRenderer.invoke(IPC_CHANNELS.readEditorFileBytes, { url, currentDocumentPath }),

  copyEditorImage: (url: string, currentDocumentPath: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.copyEditorImage, { url, currentDocumentPath }),

  resolveEditorVideo: (url: string, currentDocumentPath: string | null): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.resolveEditorVideo, { url, currentDocumentPath }),

  openEditorFile: (url: string, currentDocumentPath: string | null): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.openEditorFile, { url, currentDocumentPath }),

  editorFileExists: (url: string, currentDocumentPath: string | null): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.editorFileExists, { url, currentDocumentPath }),

  openLocalLink: (url: string, currentDocumentPath: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.openLocalLink, { url, currentDocumentPath }),

  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),

  exportHtml: (data: ExportHtmlData) => ipcRenderer.invoke(IPC_CHANNELS.exportHtml, data),

  exportPdf: (data: ExportHtmlData) => ipcRenderer.invoke(IPC_CHANNELS.exportPdf, data),

  exportZip: (data: ExportZipData) => ipcRenderer.invoke(IPC_CHANNELS.exportZip, data),

  exportText: (data: ExportTextData) => ipcRenderer.invoke(IPC_CHANNELS.exportText, data),

  exportDocx: (data: ExportDocxData) => ipcRenderer.invoke(IPC_CHANNELS.exportDocx, data),

  exportImage: (data: ExportImageData) => ipcRenderer.invoke(IPC_CHANNELS.exportImage, data),

  openExternalLink: (url: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.openExternalLink, url),

  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate),

  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.installUpdate),

  onUpdateDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => {
    ipcRenderer.on(IPC_CHANNELS.updateDownloadProgress, (_event, progress: UpdateDownloadProgress) => callback(progress))
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
