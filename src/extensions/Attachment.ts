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

const getAttachmentTypeLabel = (fileType: string): string =>
  fileType ? fileType.slice(0, 4).toLocaleUpperCase() : "FILE";

const cardClasses =
  "xmd-attachment my-2 flex h-16 w-[400px] max-w-full items-center gap-3 rounded-lg border border-line bg-paper px-3 text-left hover:border-muted hover:bg-toolbar focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent";

export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

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
        ["span", { class: "text-[11px] leading-4 text-muted" }, formatAttachmentSize(Number(attrs.fileSize))],
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
            element.querySelectorAll<HTMLAnchorElement>("a[title]").forEach((link) => {
              const metadata = decodeAttachmentMetadata(link.getAttribute("title"));
              if (!metadata) return;

              const attachment = document.createElement("div");
              attachment.dataset.xmdAttachment = "";
              attachment.dataset.xmdCompatibleAttachment = "";
              attachment.dataset.fileName = link.textContent || "未命名文件";
              attachment.dataset.fileSize = String(metadata.fileSize);
              attachment.dataset.fileType = metadata.fileType;
              attachment.dataset.url = link.getAttribute("href") ?? "";
              link.replaceWith(attachment);
            });
          },
        },
      },
    };
  },
});
