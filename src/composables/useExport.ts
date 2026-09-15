import { Editor } from "@tiptap/core";
import DOMPurify from "dompurify";
import JSZip from "jszip";
import { createEditorExtensions } from "../editor/editorExtensions";
import { mediaService } from "../services/mediaService";
import { buildDocx } from "../utils/htmlToDocx";
import { decodeDataUrl } from "../utils/dataUrl";

// 导出构建阶段统一用百分比和中文说明向界面报告真实进度节点。
export interface ExportBuildProgress {
  percent: number;
  message: string;
}

export type ExportProgressReporter = (progress: ExportBuildProgress) => void;

// —— HTML 导出 ——

// 等待隐藏导出编辑器把异步内容渲染完成：
// - Mermaid 图表：渲染期间显示占位文本，完成后替换为 SVG
// - KaTeX 公式：公式库懒加载完成后才写入公式 HTML
// 判断标准是“没有进行中的渲染 + DOM 快照连续稳定 + 至少等待最短时间”。
// 本地图片不参与等待条件：图片读取失败时会一直保持无 src 的初始状态，
// 若把它当成“进行中”会导致导出永远卡到超时；读取成功的图片会改变 DOM，
// 自然被稳定检测覆盖。最坏情况下（图片损坏/缺失）导出占位，而不是白等。
const waitForRenderSettled = async (host: HTMLElement): Promise<boolean> => {
  const startedAt = performance.now();
  // 给 KaTeX / Mermaid 懒加载留出初始化时间，避免初始空状态被误判为已完成。
  const minimumWaitMs = 600;
  let lastHtml = "";
  let stableCount = 0;
  while (performance.now() - startedAt < 10000) {
    await new Promise((resolve) => setTimeout(resolve, 80));

    const hasPendingMermaid =
      host.querySelector("[data-xmd-mermaid-view]")?.textContent?.includes("正在渲染图表") ??
      false;
    const currentHtml = host.innerHTML;

    if (!hasPendingMermaid && currentHtml === lastHtml) {
      stableCount += 1;
      // 连续 3 次采样（约 240ms）内容不变，且已超过最短等待时间，视为渲染完成。
      if (stableCount >= 3 && performance.now() - startedAt >= minimumWaitMs) return true;
    } else {
      stableCount = 0;
      lastHtml = currentHtml;
    }
  }
  // 超时说明有异步内容迟迟未渲染完成，返回 false 由调用方决定是否继续导出。
  return false;
};

// 把页面当前生效的全部样式规则序列化为 CSS 文本。
// 这天然覆盖主题变量、Tailwind、代码高亮、KaTeX 与编辑器排版样式，
// 保证导出的 HTML 在任意环境打开都和编辑器中看到的一致。
const collectDocumentStyles = (): string => {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        rules.push(rule.cssText);
      }
    } catch {
      // 跨域样式表无法读取规则，跳过该表即可。
    }
  }
  return rules.join("\n");
};

// 隐藏编辑器在无交互模式下可能使用 HtmlBlock 的 <pre> 兜底 DOM。
// 导出前将其还原为安全 HTML，否则浏览器会把标签源码当作代码文字显示。
const materializeHtmlBlocks = (host: HTMLElement): void => {
  host.querySelectorAll<HTMLElement>("[data-xmd-html-view]").forEach((nodeView) => {
    const anchor = nodeView.firstElementChild;
    const preview = anchor?.firstElementChild;
    if (!preview) {
      nodeView.remove();
      return;
    }
    // Vue 节点视图外层只用于选择、拖拽和弹出编辑器，导出时仅保留 HTML 正文。
    nodeView.replaceWith(...Array.from(preview.childNodes));
  });

  host.querySelectorAll("pre[data-xmd-html-block]").forEach((placeholder) => {
    const container = document.createElement("div");
    container.innerHTML = DOMPurify.sanitize(placeholder.textContent ?? "", {
      USE_PROFILES: { html: true },
    });
    placeholder.replaceWith(container);
  });
};

// 编辑器中的代码块可以横向滚动，静态导出则必须把全部内容直接排进页面。
// 移除交互态滚动类，并用 Tailwind 工具类让超长代码按导出宽度折行。
const prepareCodeBlocksForStaticExport = (host: HTMLElement): void => {
  host.querySelectorAll<HTMLElement>("pre").forEach((pre) => {
    pre.classList.remove("overflow-x-auto", "whitespace-pre");
    pre.classList.add(
      "w-full",
      "min-w-0",
      "max-w-full",
      "!overflow-x-visible",
      "!whitespace-pre-wrap",
      "whitespace-pre-wrap",
      "!break-all",
    );

    // 代码块根节点本身也是 flex 容器，必须允许它收缩到导出页面宽度。
    pre.closest<HTMLElement>(".code-block-editor")?.classList.add("w-full", "min-w-0", "max-w-full");

    const code = pre.querySelector<HTMLElement>("code");
    code?.classList.add("!min-w-0", "!whitespace-pre-wrap", "whitespace-pre-wrap", "!break-all");
  });
};

// 导出页面自身的布局样式：让内容居中显示，并针对打印（PDF）做适配。
const EXPORT_PAGE_STYLES = `
body {
  margin: 0;
  padding: 40px 24px;
  background-color: var(--color-paper, #ffffff);
  color: var(--color-ink, #1f2328);
}
.tiptap {
  max-width: 860px;
  margin: 0 auto;
}
@media print {
  body {
    padding: 0;
  }
}
`;

// 创建隐藏的导出渲染编辑器，把 Markdown 渲染成与主编辑器一致的 DOM。
// 返回 .tiptap 内容元素；调用方负责执行 cleanup 释放编辑器与容器。
const renderExportContent = async (
  markdown: string,
  documentPath: string | null,
  reportProgress?: ExportProgressReporter,
): Promise<{ content: HTMLElement; cleanup: () => void }> => {
  reportProgress?.({ percent: 10, message: "正在准备文档" });
  // 创建隐藏渲染容器，放在屏幕外避免影响当前编辑界面。
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-99999px;top:0;width:900px;opacity:0;pointer-events:none;";
  document.body.appendChild(host);

  const exportEditor = new Editor({
    element: host,
    extensions: createEditorExtensions({
      getCurrentDocumentPath: () => documentPath,
    }),
    content: markdown,
    editable: false,
    editorProps: {
      attributes: {
        class: "prose-editor px-20 pt-4 pb-8 [&>*:first-child]:mt-0",
        spellcheck: "false",
      },
    },
  });
  reportProgress?.({ percent: 35, message: "正在渲染文档内容" });

  try {
    // 等待异步节点渲染完成；超时不阻断导出，避免用户长时间无反馈。
    const renderSettled = await waitForRenderSettled(host);
    if (!renderSettled) {
      console.warn("[export] 等待导出渲染超时，部分异步内容（Mermaid/公式）可能未渲染完整");
    }
    reportProgress?.({ percent: 75, message: "正在整理导出内容" });

    // 去掉编辑交互用的小部件（图片缩放控制点），避免出现在导出结果里。
    host.querySelectorAll("[data-xmd-image] span").forEach((node) => node.remove());
    materializeHtmlBlocks(host);
    prepareCodeBlocksForStaticExport(host);
    reportProgress?.({ percent: 90, message: "文档内容准备完成" });
    const content = host.querySelector(".tiptap");
    return {
      content: (content ?? host) as HTMLElement,
      cleanup: () => {
        exportEditor.destroy();
        host.remove();
      },
    };
  } catch (error) {
    // 无论成功失败都销毁临时编辑器和容器，避免影响页面。
    exportEditor.destroy();
    host.remove();
    throw error;
  }
};

// 把 Markdown 渲染成自包含的完整 HTML 文档。
// 渲染复用了和主编辑器完全相同的扩展配置，因此 Mermaid、KaTeX、代码高亮、
// Callout 等扩展的显示效果与编辑器一致；图片会以 data URL 形式内联。
export const buildExportHtml = async (
  markdown: string,
  documentPath: string | null,
  title: string,
  reportProgress?: ExportProgressReporter,
): Promise<string> => {
  const { content, cleanup } = await renderExportContent(markdown, documentPath, reportProgress);
  try {
    const contentHtml = content.innerHTML;

    const escapedTitle = title.replace(/[<>&"]/g, (char) => {
      const entities: Record<string, string> = {
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
      };
      return entities[char];
    });

    const html = [
      "<!DOCTYPE html>",
      '<html lang="zh-CN">',
      "<head>",
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<title>${escapedTitle}</title>`,
      `<style>${collectDocumentStyles()}</style>`,
      `<style>${EXPORT_PAGE_STYLES}</style>`,
      "</head>",
      "<body>",
      // ProseMirror 的 white-space: break-spaces 只服务于编辑光标；导出时保留会把
      // 原生 HTML 源码缩进变成大段可见空白，因此导出容器不能携带该状态类。
      `<div class="tiptap prose-editor">${contentHtml}</div>`,
      "</body>",
      "</html>",
    ].join("\n");
    reportProgress?.({ percent: 100, message: "HTML 内容生成完成" });
    return html;
  } finally {
    cleanup();
  }
};

// —— ZIP 导出 ——

// 收集 XMD 能生成的全部本地资源引用：Markdown/HTML 图片、附件和视频。
const extractLocalResourceReferences = (markdown: string): string[] => {
  const references = new Set<string>();
  const markdownImage = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  const xmdResourceLink = /\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))\s+["']xmd-(?:attachment:[^"']*|video)["']\s*\)/g;
  const htmlResource = /<(?:img|video|audio|source)\b[^>]*\bsrc=["']([^"']+)["']/gi;
  for (const pattern of [markdownImage, xmdResourceLink]) {
    for (const match of markdown.matchAll(pattern)) references.add(match[1] ?? match[2]);
  }
  for (const match of markdown.matchAll(htmlResource)) references.add(match[1]);
  return [...references];
};

const getResourceFileName = (reference: string, fallback: string): string => {
  const pathWithoutQuery = reference.split(/[?#]/, 1)[0];
  const encodedName = pathWithoutQuery.split(/[\\/]/).pop();
  if (!encodedName) return fallback;
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
};

const getAvailableZipPath = (fileName: string, usedPaths: Set<string>): string => {
  const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_") || "resource";
  const dotIndex = safeName.lastIndexOf(".");
  const stem = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : "";
  let zipPath = `assets/${safeName}`;
  let suffix = 2;
  while (usedPaths.has(zipPath.toLocaleLowerCase())) {
    zipPath = `assets/${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  usedPaths.add(zipPath.toLocaleLowerCase());
  return zipPath;
};

// 把 Markdown 文档连同引用的本地图片打包成 ZIP：
// - 根目录放 Markdown 原文（保留原文件名）
// - 图片按引用路径的相对结构存放，解压后 Markdown 里的引用仍然有效
// - http(s) 外部图片不打包；data URL 图片直接解码打包
export const buildExportZip = async (
  markdown: string,
  documentPath: string | null,
  markdownFileName: string,
  reportProgress?: ExportProgressReporter,
): Promise<ArrayBuffer> => {
  const zip = new JSZip();
  const references = extractLocalResourceReferences(markdown);
  const usedPaths = new Set<string>();
  let dataImageIndex = 0;
  let portableMarkdown = markdown;

  reportProgress?.({
    percent: references.length > 0 ? 5 : 70,
    message: references.length > 0 ? `正在收集资源 0/${references.length}` : "文档中没有本地资源",
  });

  for (const [index, reference] of references.entries()) {
    const trimmed = reference.trim();
    try {
      if (/^(?:https?:|blob:|#)/i.test(trimmed)) continue;

      let bytes: Uint8Array;
      let fileName = getResourceFileName(trimmed, "resource");
      if (/^data:/i.test(trimmed)) {
        let decoded: { mime: string; bytes: Uint8Array } | null = null;
        try {
          decoded = decodeDataUrl(trimmed);
        } catch {
          continue;
        }
        if (!decoded) continue;
        bytes = decoded.bytes;
        const mimeExtension = decoded.mime.split("/").pop()?.replace("jpeg", "jpg") || "bin";
        fileName = `image-${++dataImageIndex}.${mimeExtension}`;
      } else {
        try {
          bytes = await mediaService.readFileBytes(trimmed, documentPath);
        } catch {
          // 单个资源缺失时保留原引用，其他可用资源仍正常导出。
          continue;
        }
      }

      const zipPath = getAvailableZipPath(fileName, usedPaths);
      zip.file(zipPath, bytes);
      // 所有资源统一改成包内相对路径，绝对路径和上级目录引用传给他人后也能使用。
      portableMarkdown = portableMarkdown.replaceAll(reference, zipPath);
    } finally {
      const completed = index + 1;
      reportProgress?.({
        percent: Math.round(5 + completed / references.length * 65),
        message: `正在收集资源 ${completed}/${references.length}`,
      });
    }
  }

  zip.file(markdownFileName, portableMarkdown);
  return zip.generateAsync({ type: "arraybuffer" }, (metadata) => {
    reportProgress?.({
      percent: Math.round(70 + metadata.percent * 0.3),
      message: "正在压缩导出文件",
    });
  });
};

// —— 纯文本导出 ——

// Markdown 原文本身就是 UTF-8 纯文本，直接原样输出为 .txt 内容。
export const buildExportText = (markdown: string): string => markdown;

// —— DOCX 导出 ——

// 复用与 HTML 导出相同的隐藏渲染编辑器得到内容 DOM，
// 再由 OOXML 转换器组装成 docx 二进制，交给主进程保存。
export const buildExportDocx = async (
  markdown: string,
  documentPath: string | null,
  title: string,
  reportProgress?: ExportProgressReporter,
): Promise<ArrayBuffer> => {
  const { content, cleanup } = await renderExportContent(markdown, documentPath, (progress) => {
    reportProgress?.({
      percent: Math.round(progress.percent * 0.65),
      message: progress.message,
    });
  });
  try {
    reportProgress?.({ percent: 70, message: "正在生成 Word 文档" });
    const docx = await buildDocx(content, title);
    reportProgress?.({ percent: 100, message: "Word 文档生成完成" });
    return docx;
  } finally {
    cleanup();
  }
};
