import type {
  UpdateCheckResult,
  UpdateDownloadProgress,
  UpdateDownloadResult,
  UpdateLogsResult,
} from "./update";
import type { AiServiceApi } from "./ai";
import type { DocumentAgentApi } from "./documentAgent";
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

export interface RendererDiagnosticEvent {
  level: "error" | "info" | "warn";
  event: string;
  detail?: Record<string, string | number | boolean | null>;
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

// 打印参数（尺寸单位英寸）：由渲染进程按设置算好，主进程只做校验后交给 printToPDF。
export interface PdfPrintOptions {
  pageSize: string | { width: number; height: number };
  margins: { top: number; right: number; bottom: number; left: number };
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
}

// 导出 PDF：除 HTML 外还要带上纸张、页边距与页眉页脚。
export interface ExportPdfData {
  html: string;
  suggestedName: string;
  printOptions: PdfPrintOptions;
}

// 导出为纯文本：渲染进程直接把文档原文交给主进程写 .txt 文件。
export interface ExportTextData {
  text: string;
  suggestedName: string;
}

// 导出为 DOCX：渲染进程已组装好的 docx 二进制数据，主进程负责落盘。
export interface ExportDocxData {
  docxData: ArrayBuffer;
  suggestedName: string;
}

// 导出为 ZIP 包：渲染进程打包好的 zip 二进制数据。
export interface ExportZipData {
  zipData: ArrayBuffer;
  suggestedName: string;
}

// 导出为图片：渲染进程交给主进程的完整 HTML，由隐藏窗口栅格化为 PNG 后落盘。
export interface ExportImageData {
  html: string;
  suggestedName: string;
}

// 写入 PNG 文件：渲染进程先用 choosePngSavePath 拿到落盘路径，
// 生成图片后再把每张图片的二进制交给主进程；
// 多于一张时主进程按「原名-1.png、原名-2.png…」依次落盘。
export interface WritePngFilesData {
  filePath: string;
  slices: Uint8Array[];
}

// 本地链接打开结果：markdown 表示链接指向 Markdown 文档，
// 由渲染进程在编辑器内以文档打开；opened 表示已交给系统默认应用。
export type OpenLocalLinkResult =
  | { kind: "markdown"; filePath: string }
  | { kind: "opened" };

// 本地文件探测结果：exists 表示磁盘上是否存在该文件；
// size 为真实字节数，文件不存在或地址没有本地文件概念（远程、data URL）时为 0。
export interface EditorFileStat {
  exists: boolean;
  size: number;
}

// 图片文件整理：重命名、移动到其它目录、删除磁盘文件。
// 只对本地图片有效，远程地址与 data URL 会由主进程直接拒绝。
export type EditorImageEditAction = "rename" | "move" | "delete-file";

export interface EditorImageEditRequest {
  /** 文档里写的图片地址（相对文档目录或绝对路径）。 */
  url: string;
  currentDocumentPath: string | null;
  action: EditorImageEditAction;
  /** 仅重命名需要：新的文件名，可以省略扩展名。 */
  newName?: string;
}

// 整理完成后文档里应该使用的图片地址：删除磁盘文件时为 null（引用由渲染层自行移除）。
export interface EditorImageEditResult {
  url: string | null;
}

export interface ElectronAPI {
  aiService: AiServiceApi;
  /** 当前文档 Agent 的执行和进度接口。 */
  documentAgent: DocumentAgentApi;
  getPathForFile: (file: File) => string;
  openFile: () => Promise<OpenFileData[] | null>;
  openDroppedFiles: (filePaths: string[]) => Promise<OpenFileData[]>;
  getUpdateLogs: () => Promise<UpdateLogsResult>;
  saveFile: (data: SaveFileData) => Promise<SaveFileResult>;
  /** 把设置页的快捷键同步到主进程，用于更新系统菜单加速键。 */
  updateShortcuts: (shortcuts: Record<string, string>) => void;
  showErrorMessage: (title: string, message: string) => Promise<void>;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  confirmWindowClose: () => void;
  onRequestWindowClose: (callback: () => void) => void;
  showApplicationMenu: (position: ApplicationMenuPosition) => Promise<void>;
  notifyRendererReady: () => Promise<OpenFileData[]>;
  notifyRendererViewReady: () => void;
  logRendererDiagnostic: (event: RendererDiagnosticEvent) => void;
  onMenuNewFile: (callback: () => void) => void;
  onMenuOpenFile: (callback: (data: OpenFileData) => void) => void;
  onMenuSaveFile: (callback: () => void) => void;
  onMenuSaveAsFile: (callback: () => void) => void;
  onMenuFindReplace: (callback: () => void) => void;
  onMenuExportHtml: (callback: () => void) => void;
  onMenuExportPdf: (callback: () => void) => void;
  onMenuExportZip: (callback: () => void) => void;
  onMenuExportText: (callback: () => void) => void;
  onMenuExportDocx: (callback: () => void) => void;
  onMenuExportImage: (callback: () => void) => void;
  onMenuOpenRecentFile: (callback: (filePath: string) => void) => void;
  onMenuClearRecentFiles: (callback: () => void) => void;
  getRecentFiles: () => Promise<string[]>;
  addRecentFiles: (filePaths: string[]) => Promise<void>;
  removeRecentFile: (filePath: string) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  removeAllListeners: (channel: IpcChannel) => void;
  exportHtml: (data: ExportHtmlData) => Promise<ExportResult>;
  exportPdf: (data: ExportPdfData) => Promise<ExportResult>;
  exportZip: (data: ExportZipData) => Promise<ExportResult>;
  exportText: (data: ExportTextData) => Promise<ExportResult>;
  exportDocx: (data: ExportDocxData) => Promise<ExportResult>;
  exportImage: (data: ExportImageData) => Promise<ExportResult>;
  /** 代码块导出图片第一步：弹出保存对话框并返回用户选择的路径，取消时返回 null。 */
  choosePngSavePath: (suggestedName: string) => Promise<string | null>;
  /** 代码块导出图片第二步：把生成好的 PNG 分片写入已选定路径（多片时自动编号）。 */
  writePngFiles: (data: WritePngFilesData) => Promise<void>;
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
  /** 监听一批已打开文档的磁盘变化；外部程序写入后会发送 externalFileChanged 事件。 */
  watchExternalFiles: (filePaths: string[]) => Promise<void>;
  /** 监听单个已打开文档的外部修改通知，返回取消监听的函数。 */
  onExternalFileChanged: (callback: (filePath: string) => void) => () => void;
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
  editorFileStat: (
    url: string,
    currentDocumentPath: string | null,
  ) => Promise<EditorFileStat>;
  editEditorImage: (
    request: EditorImageEditRequest,
  ) => Promise<EditorImageEditResult>;
  openLocalLink: (
    url: string,
    currentDocumentPath: string | null,
  ) => Promise<OpenLocalLinkResult>;
  openExternalLink: (url: string) => Promise<void>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<UpdateDownloadResult>;
  installUpdate: () => Promise<void>;
  onUpdateDownloadProgress: (
    callback: (progress: UpdateDownloadProgress) => void,
  ) => void;
}
