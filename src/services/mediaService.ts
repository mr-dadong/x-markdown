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
  ) => {
    const histories = new Map<
      string,
      Array<{ copiedBytes: number; measuredAt: number }>
    >();
    return window.electronAPI.onAttachmentCopyProgress((progress) => {
      const measuredAt = performance.now();
      const history = histories.get(progress.requestId) ?? [];
      history.push({ copiedBytes: progress.copiedBytes, measuredAt });

      // 保留约两秒的采样窗口，并留下窗口边界前的一个点用于计算完整时间差。
      const windowStart = measuredAt - 2000;
      while (history.length > 2 && history[1].measuredAt < windowStart) {
        history.shift();
      }

      let bytesPerSecond = progress.bytesPerSecond;
      const oldest = history[0];
      if (oldest && progress.copiedBytes > oldest.copiedBytes) {
        const elapsedMilliseconds = measuredAt - oldest.measuredAt;
        if (elapsedMilliseconds > 0) {
          bytesPerSecond =
            ((progress.copiedBytes - oldest.copiedBytes) * 1000) /
            elapsedMilliseconds;
        }
      }

      callback({ ...progress, bytesPerSecond });
      if (progress.status === "copying") {
        histories.set(progress.requestId, history);
      } else {
        histories.delete(progress.requestId);
      }
    });
  },
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
  copyImage: (url: string, currentDocumentPath: string | null) =>
    window.electronAPI.copyEditorImage(url, currentDocumentPath),
  resolveVideo: (url: string, currentDocumentPath: string | null) =>
    window.electronAPI.resolveEditorVideo(url, currentDocumentPath),
  openFile: (url: string, currentDocumentPath: string | null) =>
    window.electronAPI.openEditorFile(url, currentDocumentPath),
  fileExists: (url: string, currentDocumentPath: string | null) =>
    window.electronAPI.editorFileExists(url, currentDocumentPath),
  openLocalLink: (url: string, currentDocumentPath: string | null) =>
    window.electronAPI.openLocalLink(url, currentDocumentPath),
};
