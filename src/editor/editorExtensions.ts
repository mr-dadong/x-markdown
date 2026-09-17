import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type MarkdownIt from "markdown-it";
import StarterKit from "@tiptap/starter-kit";
import { markInputRule } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Highlight from "@tiptap/extension-highlight";
import markdownItMark from "markdown-it-mark";
import Typography from "@tiptap/extension-typography";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";

// 脚注引用渲染为 <sup data-xmd-footnote-reference>，若不排除，
// Subscript/Superscript 会抢占该元素的解析，导致脚注引用丢失。
const PlainSubscript = Subscript.extend({
  parseHTML() {
    return [{ tag: "sub:not([data-xmd-footnote-reference])" }];
  },
});

const PlainSuperscript = Superscript.extend({
  parseHTML() {
    return [{ tag: "sup:not([data-xmd-footnote-reference])" }];
  },
});
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Color from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { DEFAULT_CODE_BLOCK_LANGUAGE } from "../modules/codeBlockLanguages";
import { SectionCollapse } from "../extensions/SectionCollapse";
import { BlockMarquee } from "../extensions/BlockMarquee";
import { Video } from "../extensions/Video";
import { Attachment } from "../extensions/Attachment";
import { AttachmentTransfer } from "../extensions/AttachmentTransfer";
import { LegacyMediaFilter } from "../extensions/LegacyMediaFilter";
import { RawMarkdownBlock } from "../extensions/RawMarkdownBlock";
import { AiGhostMark } from "../extensions/AiGhostMark";
import { CodeOccurrenceHighlight } from "../extensions/CodeOccurrenceHighlight";
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
import {
  InlineCodeOpeningBacktick,
  SafeInlineCode,
} from "./inlineCodeInputExtension";
import { TableColumnAlignment } from "./tableColumnAlignmentExtension";
import { MarkdownEscapeRelaxer } from "./markdownEscapeRelaxer";
import { LiteralHardBreak } from "./hardBreakSerialization";
import { mediaService } from "../services/mediaService";
import { openImagePreview } from "../modules/imagePreviewOverlay";
import {
  configureTyporaTableParsing,
  ensureTableCellsHaveContent,
  parseTableAlignment,
  serializeMarkdownTableNode,
} from "./markdownSerialization";

const createAlignedTableCell = <T extends typeof TableCell>(extension: T) =>
  extension.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        alignment: {
          default: null,
          parseHTML: (element) => parseTableAlignment(element.style.textAlign),
          renderHTML: (attributes) =>
            attributes.alignment
              ? { style: `text-align: ${attributes.alignment}` }
              : {},
        },
      };
    },
  });

const AlignedTableCell = createAlignedTableCell(TableCell);
const AlignedTableHeader = createAlignedTableCell(TableHeader);

// TipTap 官方 Link 扩展未定义 title 属性，带标题的链接在解析时会丢失标题。
// 补上 title 后，序列化仍走 tiptap-markdown 复用的 prosemirror-markdown
// 默认 link 输出，其本身已支持 `[文字](地址 "标题")` 格式。
const LinkWithTitle = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("title"),
        renderHTML: (attributes) =>
          attributes.title ? { title: attributes.title } : {},
      },
    };
  },
});

// ==文字== 不是 CommonMark 语法，markdown-it 默认不识别；借助 markdown-it-mark
// 提供解析。序列化时无颜色的高亮输出 ==，带颜色的高亮无法用 == 表达，
// 回退为 <mark style> HTML 标签。配置用 WeakSet 防止重复挂载。
const configuredMarkParsers = new WeakSet<MarkdownIt>();

const SerializableHighlight = Highlight.extend({
  addInputRules() {
    return [
      // 输入 ==文字== 的最后一个 = 时立即转换为高亮，符合所见即所得的使用习惯。
      markInputRule({
        find: /(?:^|[^=])(==(?!\s)([^=]+)==)$/u,
        type: this.type,
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: { attrs: { color?: string | null } }) =>
            mark.attrs.color
              ? `<mark style="background-color: ${mark.attrs.color}">`
              : "==",
          close: (_state: unknown, mark: { attrs: { color?: string | null } }) =>
            (mark.attrs.color ? "</mark>" : "=="),
        },
        parse: {
          setup(markdown: MarkdownIt) {
            if (configuredMarkParsers.has(markdown)) return;
            configuredMarkParsers.add(markdown);
            markdown.use(markdownItMark);
          },
        },
      },
    };
  },
});

// markdown-it 会把“普通项目 + 任务项目”组成的整个列表识别为 taskList。
// 默认扩展只允许 taskItem，会在普通项目的位置补出空任务；这里明确允许两种
// 列表项共存，保证从 Typora 等编辑器打开混合列表后不会污染原文。
const CompatibleTaskList = TaskList.extend({
  content: "(taskItem|listItem)+",
});

const SerializableTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      codePipeStyles: {
        default: [],
        parseHTML: (element) => {
          const value = element.getAttribute("data-xmd-code-pipe-styles");
          return value === null ? [] : JSON.parse(decodeURIComponent(value));
        },
        // 仅作为 Markdown 往返风格标记，不输出到编辑器 DOM。
        renderHTML: () => ({}),
      },
      delimiterWidths: {
        default: [],
        parseHTML: (element) => {
          const value = element.getAttribute("data-xmd-delimiter-widths");
          return value === null ? [] : JSON.parse(decodeURIComponent(value));
        },
        // 仅作为 Markdown 往返风格标记，不输出到编辑器 DOM。
        renderHTML: () => ({}),
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          serializeMarkdownTableNode(state, node);
        },
        parse: {
          setup(markdown: MarkdownIt) {
            configureTyporaTableParsing(markdown);
            ensureTableCellsHaveContent(markdown);
          },
        },
      },
    };
  },
});

// Markdown 中保存可迁移的相对路径，节点视图单独读取本地文件用于显示。
// 这样预览所需的 data URL 不会污染实际文档内容。
//
// 尺寸属性说明：Markdown 图片语法本身不表达尺寸，社区通行的做法是用 HTML 写
// `<img src="..." width="16" height="16">`（favicon、徽章等行内小图标尤其常见）。
// 因此 width 与 height 都要被节点接收并原样写回，否则用户写下的尺寸会被静默丢弃、
// 图片退化成自然尺寸（24×24 或 48×48 的图标放进正文会明显大于文字）。
const createLocalImage = (getCurrentDocumentPath?: () => string | null) =>
  Image.extend({
    addAttributes() {
      // 只接受正整数像素值；解析不到合法数值时返回 null，交由默认样式处理。
      const parsePixelAttribute = (name: string) => (element: HTMLElement): number | null => {
        const raw = Number.parseInt(element.getAttribute(name) ?? "", 10);
        return Number.isFinite(raw) && raw > 0 ? raw : null;
      };

      return {
        ...this.parent?.(),
        width: {
          default: null,
          parseHTML: parsePixelAttribute("width"),
          renderHTML: (attributes) =>
            attributes.width ? { width: String(attributes.width) } : {},
        },
        height: {
          default: null,
          parseHTML: parsePixelAttribute("height"),
          renderHTML: (attributes) =>
            attributes.height ? { height: String(attributes.height) } : {},
        },
      };
    },
    addNodeView() {
      return ({ node, editor, getPos }) => {
        let currentNode = node;
        const wrapper = document.createElement("span");
        const image = document.createElement("img");
        // 选中遮罩复用视频块框选时的半透明蓝色表面，让大图中部也能看出选中状态。
        const selectionSurface = document.createElement("span");
        const resizeHandle = document.createElement("span");
        // 悬停在图片上时浮出的工具条：承载放大预览等操作按钮。
        // 浅色主题下 accent 是近黑色，角上放方块按钮会像黑痂，
        // 改用与编辑器其他浮层一致的纸底描边小工具条。
        // 容器底部留 4px 透明 padding 作为 hover 过渡桥：
        // 鼠标从图片移向按钮的路上不会离开 wrapper 的 hover 范围，工具条不会闪消。
        const toolbar = document.createElement("span");
        toolbar.className =
          "absolute bottom-full right-0 hidden flex-col items-end pb-1 group-hover:flex";
        toolbar.contentEditable = "false";
        const toolbarPill = document.createElement("span");
        toolbarPill.className =
          "flex items-center gap-0.5 rounded-md border border-line bg-paper p-0.5";
        const zoomButton = document.createElement("span");
        zoomButton.className =
          "flex h-6 w-6 cursor-pointer items-center justify-center rounded text-icon hover:bg-control-hover hover:text-ink";
        zoomButton.title = "放大预览";
        // 内联放大镜图标（填充路径绘制，不使用 stroke-width 属性）
        zoomButton.innerHTML =
          '<svg viewBox="0 0 16 16" class="h-3.5 w-3.5"><path fill="currentColor" d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"></path></svg>';
        toolbarPill.append(zoomButton);
        toolbar.append(toolbarPill);

        // 行内容器保留图片与前后文字的关系，图片本身仍可单独选中和调整宽度。
        // group：供工具条用 group-hover 在鼠标悬停时显示。
        wrapper.className = "relative inline-flex max-w-full align-middle rounded-sm group";
        wrapper.dataset.xmdImage = "";
        selectionSurface.className =
          "pointer-events-none absolute inset-0 hidden rounded-lg bg-[#007aff]/[0.20] dark:bg-[#0a84ff]/[0.24]";
        selectionSurface.contentEditable = "false";
        // 拖宽控制点：蓝色圆点与选中描边同色，纸色描边把它与图片内容隔开
        resizeHandle.className =
          "absolute bottom-0 right-0 hidden h-3.5 w-3.5 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-full border-2 border-paper bg-link";
        resizeHandle.contentEditable = "false";

        const openPreview = (): void => {
          openImagePreview({
            src: currentNode.attrs.src,
            alt: currentNode.attrs.alt ?? null,
            currentDocumentPath: getCurrentDocumentPath?.() ?? null,
          });
        };

        zoomButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openPreview();
        });

        // 双击图片本体同样打开放大预览；链接里的行内小图标除外，
        // 那种图标双击的第一下已经触发「打开链接」，再叠预览会互相打扰。
        wrapper.addEventListener("dblclick", (event) => {
          if (wrapper.closest("a")) return;
          event.preventDefault();
          event.stopPropagation();
          openPreview();
        });

        const renderImage = (src: string, alt: string | null, title: string | null): void => {
          image.alt = alt ?? "";
          image.title = title ?? "";
          // 用户通过 HTML 属性指定的尺寸优先；未指定时清空内联样式，
          // 交回全局图片样式（max-width:100%、height:auto）按自然比例显示。
          image.style.width = currentNode.attrs.width ? `${currentNode.attrs.width}px` : "";
          image.style.height = currentNode.attrs.height ? `${currentNode.attrs.height}px` : "";
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
            // 拉伸过程中同步解除固定高度，否则宽高比被锁死会把图片拉变形。
            image.style.height = "";
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
                // 用户手动调整宽度后，原先按图标标注的固定高度不再成立，
                // 一并清空，让图片按原图比例显示。
                height: null,
              }),
            );
          };

          resizeHandle.addEventListener("pointermove", resize);
          resizeHandle.addEventListener("pointerup", finishResize);
          resizeHandle.addEventListener("pointercancel", finishResize);
        });

        wrapper.append(image, selectionSurface, resizeHandle, toolbar);
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
            // 与视频节点统一使用 ProseMirror 的标准选中类，共用同一套选中样式。
            wrapper.classList.add("ProseMirror-selectednode");
            selectionSurface.classList.remove("hidden");
            resizeHandle.classList.remove("hidden");
          },
          deselectNode: () => {
            wrapper.classList.remove("ProseMirror-selectednode");
            selectionSurface.classList.add("hidden");
            resizeHandle.classList.add("hidden");
          },
          stopEvent: (event) =>
            event.target === resizeHandle ||
            toolbar.contains(event.target as Node),
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
            const height = node.attrs.height ? ` height="${node.attrs.height}"` : "";

            // 带尺寸的图片使用 Markdown 兼容的 HTML 写法，重新打开后仍可继续调整。
            // width 与 height 必须一起写回，否则用户标注的行内图标尺寸会在存盘后丢失。
            if (width || height) {
              state.write(`<img src="${source}" alt="${alt}"${title}${width}${height}>`);
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
      code: false, // 使用不会误删反引号前普通字符的行内代码扩展
      hardBreak: false, // 使用保留源码写法的硬换行扩展
    }),
    LiteralHardBreak,
    SafeInlineCode,
    InlineCodeOpeningBacktick,
    Markdown.configure({
      html: true,
      // 普通文本中的单个换行也应在编辑器中显示为换行，符合所见即所得的使用习惯。
      breaks: true,
      // 禁用粘贴文本的 Markdown 转换：编辑器之间的复制粘贴使用 HTML 数据（ProseMirror 优先解析），
      // 而从外部应用（如终端、配置文件）粘贴纯文本时不应被错误地转义（如 [Unit] → \[Unit\]）。
      transformPastedText: false,
      transformCopiedText: true,
    }),
    // 序列化输出前放宽惰性转义（Typora 风格：两侧皆空白的 \* 不再转义）
    MarkdownEscapeRelaxer,
    LegacyMediaFilter,
    RawMarkdownBlock,
    // 扩展模块各自管理 Markdown 解析、可视化和序列化，便于独立维护或替换。
    HtmlBlock.configure({ getCurrentDocumentPath: getCurrentDocumentPath ?? (() => null) }),
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
      inline: true,
      allowBase64: false,
    }),
    SerializableTable.configure({
      resizable: true,
    }),
    TableRow,
    AlignedTableCell,
    AlignedTableHeader,
    TableColumnAlignment,
    TrailingParagraph,
    ReadableGapCursor,
    ClickableBlockGap,
    BlockMarquee,
    SerializableHighlight.configure({
      multicolor: true,
    }),
    Typography,
    Placeholder.configure({
      placeholder: "开始写作...",
    }),
    Underline,
    PlainSubscript,
    PlainSuperscript,
    TextAlign.configure({
      types: ["heading", "paragraph"],
    }),
    LinkWithTitle.configure({
      openOnClick: false,
      // tiptap Link 的 XSS 白名单会把含「/」的相对路径链接整条丢弃（其内部正则
      // 的 .-: 被当作字符范围，连带排除了 / 和数字），本地相对链接会静默变纯文本。
      // 这里只在链接带协议头时才做协议白名单校验，相对路径交由主进程解析打开。
      isAllowedUri: (url, ctx) =>
        /^[a-z][a-z0-9+.-]*:/i.test(url) ? ctx.defaultValidate(url) : true,
    }),
    Color,
    TextStyle,
    CompatibleTaskList,
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
    CodeOccurrenceHighlight,
    AiGhostMark.configure({
      ghostClass: "ai-ghost-content",
    }),
  ];
};
