import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Color from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { DEFAULT_CODE_BLOCK_LANGUAGE } from "../modules/codeBlockLanguages";
import { SectionCollapse } from "../extensions/SectionCollapse";
import { Video } from "../extensions/Video";
import { Attachment } from "../extensions/Attachment";
import { AttachmentTransfer } from "../extensions/AttachmentTransfer";
import { LegacyMediaFilter } from "../extensions/LegacyMediaFilter";
import { RawMarkdownBlock } from "../extensions/RawMarkdownBlock";
import {
  Callout,
  FootnoteDefinition,
  FootnoteReference,
  HtmlBlock,
  MathBlock,
  MathInline,
  MermaidBlock,
  TableOfContents,
} from "../extensions/markdown";
import {
  editorLowlight,
  InteractiveCodeBlock,
} from "./codeBlockExtension";
import {
  ClickableBlockGap,
  ReadableGapCursor,
  TrailingParagraph,
} from "./documentStructureExtensions";
import { mediaService } from "../services/mediaService";

// Markdown 中保存可迁移的相对路径，节点视图单独读取本地文件用于显示。
// 这样预览所需的 data URL 不会污染实际文档内容。
const createLocalImage = (getCurrentDocumentPath?: () => string | null) =>
  Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        width: {
          default: null,
          parseHTML: (element) => element.getAttribute("width"),
          renderHTML: (attributes) =>
            attributes.width ? { width: String(attributes.width) } : {},
        },
      };
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let currentNode = node;
        const wrapper = document.createElement("div");
        const image = document.createElement("img");
        const resizeHandle = document.createElement("span");

        // 图片作为独立内容块参与排版，避免图片后的文字光标继承整张图片的高度。
        wrapper.className = "relative flex w-fit max-w-full rounded-sm";
        wrapper.dataset.xmdImage = "";
        resizeHandle.className =
          "absolute bottom-0 right-0 hidden h-4 w-4 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-sm border-2 border-white bg-accent";
        resizeHandle.contentEditable = "false";

        const renderImage = (src: string, alt: string | null, title: string | null): void => {
          image.alt = alt ?? "";
          image.title = title ?? "";
          image.style.width = currentNode.attrs.width ? `${currentNode.attrs.width}px` : "";
          void mediaService
            .readImage(src, getCurrentDocumentPath?.() ?? null)
            .then((displayUrl) => {
              image.src = displayUrl;
            });
        };

        // 拖动右下角控制点时仅改变宽度，高度由浏览器按原图比例自动计算。
        resizeHandle.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();

          const startX = event.clientX;
          const startWidth = image.getBoundingClientRect().width;
          const editorWidth = editor.view.dom.getBoundingClientRect().width;
          resizeHandle.setPointerCapture(event.pointerId);

          const resize = (moveEvent: PointerEvent): void => {
            const nextWidth = Math.round(
              Math.min(editorWidth, Math.max(48, startWidth + moveEvent.clientX - startX)),
            );
            image.style.width = `${nextWidth}px`;
          };

          const finishResize = (upEvent: PointerEvent): void => {
            resizeHandle.releasePointerCapture(upEvent.pointerId);
            resizeHandle.removeEventListener("pointermove", resize);
            resizeHandle.removeEventListener("pointerup", finishResize);
            resizeHandle.removeEventListener("pointercancel", finishResize);

            if (typeof getPos !== "function") return;
            const position = getPos();
            if (position === undefined) return;
            const width = Math.round(image.getBoundingClientRect().width);
            editor.view.dispatch(
              editor.view.state.tr.setNodeMarkup(position, undefined, {
                ...currentNode.attrs,
                width,
              }),
            );
          };

          resizeHandle.addEventListener("pointermove", resize);
          resizeHandle.addEventListener("pointerup", finishResize);
          resizeHandle.addEventListener("pointercancel", finishResize);
        });

        wrapper.append(image, resizeHandle);
        renderImage(node.attrs.src, node.attrs.alt, node.attrs.title);
        return {
          dom: wrapper,
          update: (updatedNode) => {
            if (updatedNode.type.name !== node.type.name) return false;
            currentNode = updatedNode;
            renderImage(updatedNode.attrs.src, updatedNode.attrs.alt, updatedNode.attrs.title);
            return true;
          },
          selectNode: () => {
            wrapper.classList.add(
              "outline",
              "outline-2",
              "outline-offset-[3px]",
              "outline-link",
            );
            resizeHandle.classList.remove("hidden");
          },
          deselectNode: () => {
            wrapper.classList.remove(
              "outline",
              "outline-2",
              "outline-offset-[3px]",
              "outline-link",
            );
            resizeHandle.classList.add("hidden");
          },
          stopEvent: (event) => event.target === resizeHandle,
        };
      };
    },
    addStorage() {
      return {
        markdown: {
          serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
            const source = String(node.attrs.src).replaceAll('"', "&quot;");
            const alt = String(node.attrs.alt ?? "").replaceAll('"', "&quot;");
            const title = node.attrs.title
              ? ` title="${String(node.attrs.title).replaceAll('"', "&quot;")}"`
              : "";
            const width = node.attrs.width ? ` width="${node.attrs.width}"` : "";

            // 带尺寸的图片使用 Markdown 兼容的 HTML 写法，重新打开后仍可继续调整。
            if (width) {
              state.write(`<img src="${source}" alt="${alt}"${title}${width}>`);
            } else {
              state.write(`![${alt}](${source}${node.attrs.title ? ` "${node.attrs.title}"` : ""})`);
            }
          },
        },
      };
    },
  });

// 主编辑器与导出用的隐藏渲染编辑器共用同一套扩展配置，
// 保证导出结果和所见即所得视图的解析、渲染行为完全一致。
export const createEditorExtensions = (options: {
  getCurrentDocumentPath?: () => string | null;
} = {}) => {
  const { getCurrentDocumentPath } = options;
  return [
    StarterKit.configure({
      codeBlock: false, // 使用 CodeBlockLowlight 替代
    }),
    Markdown.configure({
      html: true,
      // 普通文本中的单个换行也应在编辑器中显示为换行，符合所见即所得的使用习惯。
      breaks: true,
      transformPastedText: true,
      transformCopiedText: true,
    }),
    LegacyMediaFilter,
    RawMarkdownBlock,
    // 扩展模块各自管理 Markdown 解析、可视化和序列化，便于独立维护或替换。
    HtmlBlock,
    MermaidBlock,
    MathBlock,
    MathInline,
    Callout,
    FootnoteReference,
    FootnoteDefinition,
    TableOfContents,
    InteractiveCodeBlock.configure({
      lowlight: editorLowlight,
      // 未注明语言的 Markdown 代码块按纯文本渲染，不再调用不稳定的自动识别。
      defaultLanguage: DEFAULT_CODE_BLOCK_LANGUAGE,
    }),
    createLocalImage(getCurrentDocumentPath).configure({
      inline: false,
      allowBase64: false,
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
    TrailingParagraph,
    ReadableGapCursor,
    ClickableBlockGap,
    Highlight.configure({
      multicolor: true,
    }),
    Typography,
    Placeholder.configure({
      placeholder: "开始写作...",
    }),
    Underline,
    TextAlign.configure({
      types: ["heading", "paragraph"],
    }),
    Link.configure({
      openOnClick: false,
    }),
    Color,
    TextStyle,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Video.configure({
      getCurrentDocumentPath: () => getCurrentDocumentPath?.() ?? null,
    }),
    Attachment.configure({
      getCurrentDocumentPath: () => getCurrentDocumentPath?.() ?? null,
    }),
    AttachmentTransfer,
    SectionCollapse,
  ];
};
