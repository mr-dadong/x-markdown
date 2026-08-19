import type {
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateDownloadResult,
  UpdateLogsResult,
} from "./update";
import type { IPC_CHANNELS } from "../constants/ipcChannels";

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface SaveFileData {
  filePath: string | null;
  content: string;
  expectedModifiedTime: number | null;
  force?: boolean;
}

export interface SaveFileResult {
  success: boolean;
  filePath?: string;
  modifiedTime?: number;
  conflict?: boolean;
  error?: string;
}

export interface OpenFileData {
  filePath: string;
  content: string;
  modifiedTime: number;
}

export interface ApplicationMenuPosition {
  menuIndex: number;
  x: number;
  y: number;
}

export interface SelectEditorFileOptions {
  kind: "image" | "video" | "file";
  currentDocumentPath: string | null;
  attachmentHandling?: "reference" | "copy-to-assets";
  requestId?: string;
}

export interface ImportEditorFileOptions extends SelectEditorFileOptions {
  filePath: string;
}

export interface SelectedEditorFile {
  fileName: string;
  fileSize: number;
  fileType: string;
  url: string;
}

export interface AttachmentCopyProgress {
  requestId: string;
  fileName: string;
  copiedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  status: "copying" | "completed" | "failed";
  error?: string;
}

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

export interface ReadFileResult {
  success: boolean;
  content?: string;
  modifiedTime?: number;
  error?: string;
}

export interface RecoveryDraftData {
  filePath: string | null;
  content: string;
  savedContent: string;
  modifiedTime: number | null;
}

// 导出结果：canceled 表示用户在保存对话框中取消了操作。
export interface ExportResult {
  canceled: boolean;
  filePath?: string;
}

// 导出为 HTML/PDF：渲染进程把完整 HTML 文档交给主进程打印或写文件。
export interface ExportHtmlData {
  html: string;
  suggestedName: string;
}

// 导出为 ZIP 包：渲染进程打包好的 zip 二进制数据。
export interface ExportZipData {
  zipData: ArrayBuffer;
  suggestedName: string;
}

export interface ElectronAPI {
  getPathForFile: (file: File) => string;
  openFile: () => Promise<OpenFileData[] | null>;
  openDroppedFiles: (filePaths: string[]) => Promise<OpenFileData[]>;
  getUpdateLogs: () => Promise<UpdateLogsResult>;
  saveFile: (data: SaveFileData) => Promise<SaveFileResult>;
  showErrorMessage: (title: string, message: string) => Promise<void>;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  confirmWindowClose: () => void;
  onRequestWindowClose: (callback: () => void) => void;
  showApplicationMenu: (position: ApplicationMenuPosition) => Promise<void>;
  notifyRendererReady: () => Promise<OpenFileData[]>;
  notifyRendererViewReady: () => void;
  onMenuNewFile: (callback: () => void) => void;
  onMenuOpenFile: (callback: (data: OpenFileData) => void) => void;
  onMenuSaveFile: (callback: () => void) => void;
  onMenuSaveAsFile: (callback: () => void) => void;
  onMenuFindReplace: (callback: () => void) => void;
  onMenuExportHtml: (callback: () => void) => void;
  onMenuExportPdf: (callback: () => void) => void;
  onMenuExportZip: (callback: () => void) => void;
  onMenuOpenRecentFile: (callback: (filePath: string) => void) => void;
  onMenuClearRecentFiles: (callback: () => void) => void;
  getRecentFiles: () => Promise<string[]>;
  addRecentFiles: (filePaths: string[]) => Promise<void>;
  removeRecentFile: (filePath: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  removeAllListeners: (channel: IpcChannel) => void;
  exportHtml: (data: ExportHtmlData) => Promise<ExportResult>;
  exportPdf: (data: ExportHtmlData) => Promise<ExportResult>;
  exportZip: (data: ExportZipData) => Promise<ExportResult>;
  readDirectory: (dirPath: string) => Promise<DirectoryEntry[]>;
  createFileTreeEntry: (parentPath: string, name: string, isDirectory: boolean) => Promise<void>;
  renameFileTreeEntry: (entryPath: string, newName: string) => Promise<void>;
  deleteFileTreeEntry: (entryPath: string) => Promise<void>;
  copyFileTreePath: (entryPath: string) => Promise<void>;
  showFileTreeEntry: (entryPath: string) => Promise<void>;
  selectWorkspace: () => Promise<string | null>;
  getWorkspace: () => Promise<string | null>;
  watchWorkspace: (directoryPath: string) => Promise<void>;
  unwatchWorkspace: () => Promise<void>;
  onWorkspaceChanged: (callback: () => void) => () => void;
  confirmExit: (
    openCount: number,
    modifiedCount: number,
  ) => Promise<"save" | "discard" | "cancel">;
  loadRecoveryDrafts: () => Promise<RecoveryDraftData[]>;
  saveRecoveryDrafts: (drafts: RecoveryDraftData[]) => Promise<void>;
  readFile: (filePath: string) => Promise<ReadFileResult>;
  getDirectoryName: (filePath: string) => Promise<string>;
  selectEditorFile: (
    options: SelectEditorFileOptions,
  ) => Promise<SelectedEditorFile | null>;
  importEditorFile: (
    options: ImportEditorFileOptions,
  ) => Promise<SelectedEditorFile>;
  onAttachmentCopyProgress: (
    callback: (progress: AttachmentCopyProgress) => void,
  ) => () => void;
  saveEditorImage: (
    bytes: Uint8Array,
    mimeType: string,
    currentDocumentPath: string | null,
  ) => Promise<SelectedEditorFile | null>;
  readEditorImage: (
    url: string,
    currentDocumentPath: string | null,
  ) => Promise<string>;
  readEditorFileBytes: (
    url: string,
    currentDocumentPath: string | null,
  ) => Promise<Uint8Array>;
  copyEditorImage: (
    url: string,
    currentDocumentPath: string | null,
  ) => Promise<void>;
  resolveEditorVideo: (
    url: string,
    currentDocumentPath: string | null,
  ) => Promise<string>;
  openEditorFile: (
    url: string,
    currentDocumentPath: string | null,
  ) => Promise<string>;
  editorFileExists: (
    url: string,
    currentDocumentPath: string | null,
  ) => Promise<boolean>;
  openLocalLink: (
    url: string,
    currentDocumentPath: string | null,
  ) => Promise<void>;
  openExternalLink: (url: string) => Promise<void>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<UpdateDownloadResult>;
  installUpdate: () => Promise<void>;
  onUpdateDownloadProgress: (
    callback: (progress: UpdateDownloadProgress) => void,
  ) => void;
}
