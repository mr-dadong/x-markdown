/*
 * 导出 PDF 的打印选项：把设置里的纸张、页边距、页眉页脚翻译成
 * Electron printToPDF 需要的参数（尺寸单位一律是英寸）。
 */

export type PdfPageSize = "A4" | "A3" | "Letter" | "Legal" | "custom";

export interface PdfSettings {
  pdfPageSize: PdfPageSize;
  /** 自定义纸张的宽度与高度，单位英寸。 */
  pdfPageWidth: number;
  pdfPageHeight: number;
  /** 四边统一的页边距，单位英寸。 */
  pdfMargin: number;
  pdfHeaderText: string;
  pdfFooterText: string;
}

export interface PdfPrintOptions {
  pageSize: PdfPageSize | { width: number; height: number };
  margins: { top: number; right: number; bottom: number; left: number };
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
}

/** 页眉页脚可用的占位符：与 Typora 的 ${pageNo} 写法保持一致。 */
export const PDF_PLACEHOLDERS = ["pageNo", "pageCount", "title", "date"] as const;

// Chromium 打印模板只认这几个带固定类名的元素。
const PLACEHOLDER_ELEMENTS: Record<(typeof PDF_PLACEHOLDERS)[number], string> = {
  pageNo: '<span class="pageNumber"></span>',
  pageCount: '<span class="totalPages"></span>',
  title: '<span class="title"></span>',
  date: '<span class="date"></span>',
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"]/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return entities[character];
  });

/**
 * 把用户写的页眉页脚文本转成 Chromium 的打印模板。
 * `${pageNo}` 这类占位符替换成对应元素，其余文字转义后原样输出。
 */
export const buildHeaderFooterTemplate = (text: string): string => {
  const body = text
    .split(/(\$\{[a-zA-Z]+\})/u)
    .map((part) => {
      const placeholder = part.match(/^\$\{([a-zA-Z]+)\}$/u)?.[1];
      if (placeholder && placeholder in PLACEHOLDER_ELEMENTS) {
        return PLACEHOLDER_ELEMENTS[placeholder as (typeof PDF_PLACEHOLDERS)[number]];
      }
      return escapeHtml(part);
    })
    .join("");

  // Chromium 的页眉页脚默认字号为 0，不显式写字号会导致内容完全看不见。
  return `<div style="width:100%;box-sizing:border-box;padding:0 12px;font-size:9px;color:#666666;text-align:center;">${body}</div>`;
};

/** 组装 printToPDF 的打印参数；页眉页脚都为空时关闭打印器的默认页眉页脚。 */
export const resolvePdfPrintOptions = (settings: PdfSettings): PdfPrintOptions => {
  const headerTemplate = settings.pdfHeaderText.trim()
    ? buildHeaderFooterTemplate(settings.pdfHeaderText)
    : "";
  const footerTemplate = settings.pdfFooterText.trim()
    ? buildHeaderFooterTemplate(settings.pdfFooterText)
    : "";

  return {
    pageSize:
      settings.pdfPageSize === "custom"
        ? { width: settings.pdfPageWidth, height: settings.pdfPageHeight }
        : settings.pdfPageSize,
    margins: {
      top: settings.pdfMargin,
      right: settings.pdfMargin,
      bottom: settings.pdfMargin,
      left: settings.pdfMargin,
    },
    // displayHeaderFooter 为真但模板为空时，Chromium 会打印默认的标题/网址/页码，
    // 因此只有用户真的填了内容才打开这个开关。
    displayHeaderFooter: Boolean(headerTemplate || footerTemplate),
    headerTemplate,
    footerTemplate,
  };
};

/**
 * 打印样式：把一级标题之间的自动分页交给 CSS。
 * 首个标题之前不分页，否则文档开头会多出一张空白页。
 */
export const PDF_BREAK_BETWEEN_H1_CSS = `
@media print {
  h1 {
    break-before: page;
  }
  h1:first-of-type {
    break-before: auto;
  }
}
`;
