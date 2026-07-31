import type {
  AttachmentCopyProgress,
  ImportEditorFileOptions,
  SelectEditorFileOptions,
} from "../types/electron";

export const mediaService = {
  selectFile: (options: SelectEditorFileOptions) =>
    window.electronAPI.selectEditorFile(options),
  importFile: (options: ImportEditorFileOptions) =>
    window.electronAPI.importEditorFile(options),
  onAttachmentCopyProgress: (
    callback: (progress: AttachmentCopyProgress) => void,
  ) => window.electronAPI.onAttachmentCopyProgress(callback),
  saveImage: (
    bytes: Uint8Array,
    mimeType: string,
    currentDocumentPath: string | null,
  ) =>
    window.electronAPI.saveEditorImage(
      bytes,
      mimeType,
      currentDocumentPath,
    ),
  readImage: (url: string, currentDocumentPath: string | null) =>
    window.electronAPI.readEditorImage(url, currentDocumentPath),
  resolveVideo: (url: string, currentDocumentPath: string | null) =>
    window.electronAPI.resolveEditorVideo(url, currentDocumentPath),
  openFile: (url: string, currentDocumentPath: string | null) =>
    window.electronAPI.openEditorFile(url, currentDocumentPath),
  openLocalLink: (url: string, currentDocumentPath: string | null) =>
    window.electronAPI.openLocalLink(url, currentDocumentPath),
};
