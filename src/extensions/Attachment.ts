import { Node, mergeAttributes } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import AttachmentView from "../components/AttachmentView.vue";

interface AttachmentAttributes {
  fileName: string;
  fileSize: number;
  fileType: string;
  url: string;
}

interface AttachmentMarkdownMetadata {
  fileSize: number;
  fileType: string;
}

interface AttachmentOptions {
  getCurrentDocumentPath: () => string | null;
}

const ATTACHMENT_TITLE_PREFIX = "xmd-attachment:";

// 链接文字中的反斜杠和方括号需要转义，否则文件名可能截断 Markdown 链接。
const escapeMarkdownLabel = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");

// 使用尖括号包裹链接目标，使包含空格和中文的相对路径仍是标准 Markdown。
const escapeMarkdownDestination = (value: string): string =>
  value
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E")
    .replaceAll("\n", "%0A")
    .replaceAll("\r", "%0D");

const encodeAttachmentMetadata = (
  attrs: AttachmentAttributes,
): string => {
  const metadata: AttachmentMarkdownMetadata = {
    fileSize: attrs.fileSize,
    fileType: attrs.fileType,
  };
  return `${ATTACHMENT_TITLE_PREFIX}${encodeURIComponent(JSON.stringify(metadata))}`;
};

const decodeAttachmentMetadata = (
  title: string | null,
): AttachmentMarkdownMetadata | null => {
  if (!title?.startsWith(ATTACHMENT_TITLE_PREFIX)) return null;

  try {
    const parsed = JSON.parse(
      decodeURIComponent(title.slice(ATTACHMENT_TITLE_PREFIX.length)),
    ) as Partial<AttachmentMarkdownMetadata>;
    return {
      fileSize:
        typeof parsed.fileSize === "number" && Number.isFinite(parsed.fileSize)
          ? parsed.fileSize
          : 0,
      fileType: typeof parsed.fileType === "string" ? parsed.fileType : "",
    };
  } catch {
    return null;
  }
};

export const formatAttachmentSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "未知大小";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

// 附件卡片展示用的大小文案：0 表示来源是手写链接、磁盘大小未知。
// 传输进度视图里的 0 字节是真实数值，仍使用 formatAttachmentSize。
export const formatAttachmentCardSize = (bytes: number): string =>
  bytes > 0 ? formatAttachmentSize(bytes) : "未知大小";

// 手写文件链接按后缀识别为附件卡片；图片与视频已有专门视图，不在此列。
const plainAttachmentExtensions = new Set([
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "zst", "iso",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "epub",
  "exe", "msi", "dmg", "apk", "deb", "rpm", "jar",
]);

// 从链接地址提取最后一段扩展名（tar.gz 取 gz），与主进程 path.extname 行为一致。
const getExtensionFromUrl = (url: string): string => {
  // 先剥掉查询串与锚点，避免 x.zip?v=1.2 被识别成 .2。
  const fileName = url.split(/[?#]/, 1)[0];
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex === -1 ? "" : fileName.slice(dotIndex + 1).toLocaleLowerCase();
};

// 链接独占所在段落时，替换成块级卡片才不会拆散与文字混排的行内内容。
const isSoleParagraphChild = (link: HTMLAnchorElement): boolean => {
  const paragraph = link.parentElement;
  return paragraph?.tagName === "P" && paragraph.childNodes.length === 1;
};

// 手写的裸文件链接才会增强为卡片：带 title 的链接可能携带视频标题或用户备注，
// 锚点与带协议的地址（http、mailto、file 等）也不是本地附件相对路径。
const isPlainAttachmentLink = (link: HTMLAnchorElement): boolean => {
  const href = link.getAttribute("href") ?? "";
  if (link.hasAttribute("title")) return false;
  if (href === "" || href.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  return plainAttachmentExtensions.has(getExtensionFromUrl(href));
};

const getAttachmentTypeLabel = (fileType: string): string =>
  fileType ? fileType.slice(0, 4).toLocaleUpperCase() : "FILE";

const cardClasses =
  "xmd-attachment my-2 flex h-16 w-[400px] max-w-full items-center gap-3 rounded-lg border border-line bg-paper px-3 text-left hover:border-muted hover:bg-toolbar focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export const Attachment = Node.create<AttachmentOptions>({
  name: "attachment",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      getCurrentDocumentPath: () => null,
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(AttachmentView);
  },

  addAttributes() {
    return {
      fileName: { default: "未命名文件" },
      fileSize: { default: 0 },
      fileType: { default: "" },
      url: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-xmd-compatible-attachment]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            fileName: element.dataset.fileName ?? "未命名文件",
            fileSize: Number(element.dataset.fileSize ?? 0),
            fileType: element.dataset.fileType ?? "",
            url: element.dataset.url ?? "",
          } satisfies AttachmentAttributes;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as AttachmentAttributes;
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-xmd-attachment": "",
        "data-xmd-compatible-attachment": "",
        "data-file-name": attrs.fileName,
        "data-file-size": attrs.fileSize,
        "data-file-type": attrs.fileType,
        "data-url": attrs.url,
        class: cardClasses,
        contenteditable: "false",
        tabindex: "0",
      }),
      [
        "span",
        { class: "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ink px-1 font-mono text-[9px] font-bold tracking-tight text-inverse" },
        getAttachmentTypeLabel(attrs.fileType),
      ],
      [
        "span",
        { class: "flex min-w-0 flex-1 flex-col gap-0.5" },
        ["span", { class: "truncate text-[13px] font-medium leading-5 text-ink" }, attrs.fileName],
        ["span", { class: "text-[11px] leading-4 text-muted" }, formatAttachmentCardSize(Number(attrs.fileSize))],
      ],
      [
        "button",
        {
          type: "button",
          "data-xmd-attachment-open": "",
          class:
            "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-[13px] text-muted hover:bg-control hover:text-ink focus:outline focus:outline-2 focus:outline-accent",
          title: "使用默认应用打开",
        },
        "↗",
      ],
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (value: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: AttachmentAttributes }) {
          const { fileName, url } = node.attrs;
          const label = escapeMarkdownLabel(fileName);
          const destination = escapeMarkdownDestination(url);
          const title = encodeAttachmentMetadata(node.attrs);

          // 磁盘中保存标准 Markdown 链接，其他编辑器可直接打开，XMD 再增强为附件卡片。
          state.write(`[${label}](<${destination}> "${title}")`);
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
              const href = link.getAttribute("href") ?? "";
              const metadata = decodeAttachmentMetadata(link.getAttribute("title"));
              // 手写的裸文件链接（无 XMD 附件元数据）按后缀识别，也增强为文件卡片。
              const isPlainFileLink =
                !metadata && isSoleParagraphChild(link) && isPlainAttachmentLink(link);
              if (!metadata && !isPlainFileLink) return;

              const attachment = document.createElement("div");
              attachment.dataset.xmdAttachment = "";
              attachment.dataset.xmdCompatibleAttachment = "";
              attachment.dataset.fileName = link.textContent || "未命名文件";
              // 手写链接没有大小信息，记 0 让卡片显示「未知大小」；类型从地址后缀推导。
              attachment.dataset.fileSize = String(metadata?.fileSize ?? 0);
              attachment.dataset.fileType = metadata?.fileType ?? getExtensionFromUrl(href);
              attachment.dataset.url = href;
              link.replaceWith(attachment);
            });
          },
        },
      },
    };
  },
});
