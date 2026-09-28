import type { ExportResult, PdfPrintOptions } from "../types/electron";

// 把渲染进程准备好的导出数据交给主进程落盘（HTML / PDF / ZIP / TXT / DOCX / PNG）。
export const exportService = {
  exportHtml: (html: string, suggestedName: string): Promise<ExportResult> =>
    window.electronAPI.exportHtml({ html, suggestedName }),
  exportPdf: (
    html: string,
    suggestedName: string,
    printOptions: PdfPrintOptions,
  ): Promise<ExportResult> =>
    window.electronAPI.exportPdf({ html, suggestedName, printOptions }),
  exportZip: (zipData: ArrayBuffer, suggestedName: string): Promise<ExportResult> =>
    window.electronAPI.exportZip({ zipData, suggestedName }),
  exportText: (text: string, suggestedName: string): Promise<ExportResult> =>
    window.electronAPI.exportText({ text, suggestedName }),
  exportDocx: (docxData: ArrayBuffer, suggestedName: string): Promise<ExportResult> =>
    window.electronAPI.exportDocx({ docxData, suggestedName }),
  exportImage: (html: string, suggestedName: string): Promise<ExportResult> =>
    window.electronAPI.exportImage({ html, suggestedName }),
  // 代码块导出 PNG 拆成两步：先弹保存对话框拿路径，再把生成好的分片写到该路径。
  choosePngSavePath: (suggestedName: string): Promise<string | null> =>
    window.electronAPI.choosePngSavePath(suggestedName),
  writePngFiles: (filePath: string, slices: Uint8Array[]): Promise<void> =>
    window.electronAPI.writePngFiles({ filePath, slices }),
};
