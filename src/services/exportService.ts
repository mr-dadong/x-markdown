import type { ExportResult } from "../types/electron";

// 把渲染进程准备好的导出数据交给主进程落盘（HTML / PDF / ZIP）。
export const exportService = {
  exportHtml: (html: string, suggestedName: string): Promise<ExportResult> =>
    window.electronAPI.exportHtml({ html, suggestedName }),
  exportPdf: (html: string, suggestedName: string): Promise<ExportResult> =>
    window.electronAPI.exportPdf({ html, suggestedName }),
  exportZip: (zipData: ArrayBuffer, suggestedName: string): Promise<ExportResult> =>
    window.electronAPI.exportZip({ zipData, suggestedName }),
};
