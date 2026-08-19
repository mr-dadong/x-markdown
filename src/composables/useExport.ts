import { Editor } from "@tiptap/core";
import DOMPurify from "dompurify";
import JSZip from "jszip";
import { createEditorExtensions } from "../editor/editorExtensions";
import { mediaService } from "../services/mediaService";
import { buildDocx } from "../utils/htmlToDocx";

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
): Promise<{ content: HTMLElement; cleanup: () => void }> => {
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

  try {
    // 等待异步节点渲染完成；超时不阻断导出，避免用户长时间无反馈。
    const renderSettled = await waitForRenderSettled(host);
    if (!renderSettled) {
      console.warn("[export] 等待导出渲染超时，部分异步内容（Mermaid/公式）可能未渲染完整");
    }

    // 去掉编辑交互用的小部件（图片缩放控制点），避免出现在导出结果里。
    host.querySelectorAll("[data-xmd-image] span").forEach((node) => node.remove());
    materializeHtmlBlocks(host);
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
): Promise<string> => {
  const { content, cleanup } = await renderExportContent(markdown, documentPath);
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

    return [
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

// 把 data URL 解码成二进制，供打包进 ZIP 使用。
const decodeDataUrl = (dataUrl: string): { mime: string; bytes: Uint8Array } | null => {
  const match = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const payload = match[3];
  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime, bytes };
  }
  const decoded = decodeURIComponent(payload);
  return { mime, bytes: new TextEncoder().encode(decoded) };
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
): Promise<ArrayBuffer> => {
  const zip = new JSZip();
  const references = extractLocalResourceReferences(markdown);
  const usedPaths = new Set<string>();
  let dataImageIndex = 0;
  let portableMarkdown = markdown;

  for (const reference of references) {
    const trimmed = reference.trim();
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
  }

  zip.file(markdownFileName, portableMarkdown);
  return zip.generateAsync({ type: "arraybuffer" });
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
): Promise<ArrayBuffer> => {
  const { content, cleanup } = await renderExportContent(markdown, documentPath);
  try {
    return await buildDocx(content, title);
  } finally {
    cleanup();
  }
};
