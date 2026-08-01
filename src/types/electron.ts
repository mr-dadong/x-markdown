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
  removeAllListeners: (channel: IpcChannel) => void;
  readDirectory: (dirPath: string) => Promise<DirectoryEntry[]>;
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
