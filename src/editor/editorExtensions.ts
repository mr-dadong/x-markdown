import StarterKit from "@tiptap/starter-kit";
import { markInputRule, type JSONContent, type MarkdownParseHelpers, type MarkdownToken } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Highlight from "@tiptap/extension-highlight";
import { HtmlSafeTypography } from "./htmlSafeTypography";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";

// 脚注引用渲染为 <sup data-xmd-footnote-reference>，若不排除，
// Subscript/Superscript 会抢占该元素的解析，导致脚注引用丢失。
// Markdown 没有上下标语法，落盘统一用 HTML 标签，与行内 HTML 的解析路径对称；
// 官方 MarkdownManager 会用 htmlReopen 在标记重叠的边界按 HTML 重新开合。
const PlainSubscript = Subscript.extend({
  parseHTML() {
    return [{ tag: "sub:not([data-xmd-footnote-reference])" }];
  },

  renderMarkdown: (node, helpers) => `<sub>${helpers.renderChildren(node)}</sub>`,

  markdownOptions: { htmlReopen: { open: "<sub>", close: "</sub>" } },
});

const PlainSuperscript = Superscript.extend({
  parseHTML() {
    return [{ tag: "sup:not([data-xmd-footnote-reference])" }];
  },

  renderMarkdown: (node, helpers) => `<sup>${helpers.renderChildren(node)}</sup>`,

  markdownOptions: { htmlReopen: { open: "<sup>", close: "</sup>" } },
});
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Color from "@tiptap/extension-color";
import { BackgroundColor, FontSize, TextStyle } from "@tiptap/extension-text-style";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { DEFAULT_CODE_BLOCK_LANGUAGE } from "../modules/codeBlockLanguages";
import { SectionCollapse } from "../extensions/SectionCollapse";
import { BlockMarquee } from "../extensions/BlockMarquee";
import { Video, VideoLinkParser } from "../extensions/Video";
import { Attachment, AttachmentLinkParser } from "../extensions/Attachment";
import { AttachmentTransfer } from "../extensions/AttachmentTransfer";
import { RawMarkdownBlock, LinkReferenceDefinition } from "../extensions/RawMarkdownBlock";
import { installHtmlEntityDecoding } from "./markdownEntityDecoding";
import { AiGhostMark } from "../extensions/AiGhostMark";
import { CodeOccurrenceHighlight } from "../extensions/CodeOccurrenceHighlight";
import {
  Callout,
  FootnoteDefinition,
  FootnoteReference,
  HtmlBlock,
  HtmlTextTag,
  MathBlock,
  MathInline,
  MermaidBlock,
  PageBreak,
  TableOfContents,
} from "../extensions/markdown";
import {
  editorLowlight,
  InteractiveCodeBlock,
} from "./codeBlockExtension";
import {
  ClickableBlockGap,
  InlineImageParagraph,
  ReadableGapCursor,
  TrailingParagraph,
} from "./documentStructureExtensions";
import {
  InlineCodeOpeningBacktick,
  SafeInlineCode,
} from "./inlineCodeInputExtension";
import { TableColumnAlignment } from "./tableColumnAlignmentExtension";
import { MarkdownEscapeRelaxer } from "./markdownEscapeRelaxer";
import { installLiteralInlineHtmlParsing } from "./markdownInlineHtmlLiteral";
import {
  InlineHtmlSourceForm,
  installInlineHtmlSourceFormSerialization,
} from "./inlineHtmlSourceForm";
import { installMinimalTextEscaping } from "./markdownTextEscaping";
import { LiteralHardBreak } from "./hardBreakSerialization";
import { readImageSizeAttribute, readStylePixels, readStyleZoom, stripStyleSizes, toCssLength } from "./imageStyle";
import {
  HtmlBlockSourceForm,
  installHtmlBlockSourceFormSerialization,
} from "./htmlBlockSourceForm";
import { mediaService } from "../services/mediaService";
import { openImagePreview } from "../modules/imagePreviewOverlay";
import {
  escapeTablePipes,
  getTableCodePipeStyles,
  getTableDelimiterWidths,
  renderMarkdownTable,
  restoreTableBackticks,
  type MarkdownTableCell,
  type TableAlignment,
} from "./markdownSerialization";

/** 把单元格对齐取值收敛到 Markdown 能表达的三种，其余一律视为无对齐。 */
const toTableAlignment = (value: unknown): TableAlignment => {
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "left" || normalized === "center" || normalized === "right"
    ? normalized
    : null;
};

/**
 * 官方 Table 扩展自带的表格解析：把 marked 的 table token 转成
 * tableRow / tableCell / tableHeader 结构，并按 token.align 写入单元格的 align 属性。
 *
 * 它是纯函数（源码里是箭头函数，不读 this），因此可以直接复用，不必在项目里
 * 再抄一遍单元格构造逻辑。类型上该字段是可选的，这里显式断言：官方一旦移除它，
 * 表格解析会立刻抛错，而不是静默换一套结构。
 */
const parseOfficialTableMarkdown = Table.config.parseMarkdown! as (
  token: MarkdownToken,
  helpers: MarkdownParseHelpers,
) => JSONContent;

// TipTap 官方 Link 扩展未定义 title 属性，带标题的链接在解析时会丢失标题。
// 补上 title 后，官方 Link 扩展自带的 renderMarkdown 会输出
// `[文字](地址 "标题")` 格式，无需额外接管序列化。
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

// 官方 Highlight 扩展已自带 ==文字== 的解析与序列化，这里只补「带颜色」的分支：
// == 无法表达颜色，回退为 <mark style> HTML 标签。
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

  renderMarkdown: (node, helpers) => {
    const content = helpers.renderChildren(node);
    const color = node.attrs?.color;
    return color
      ? `<mark style="background-color: ${color}">${content}</mark>`
      : `==${content}==`;
  },
});

/** textStyle 上承载的样式属性与对应的 CSS 属性名。 */
const TEXT_STYLE_CSS_PROPERTIES: Array<[attribute: string, cssProperty: string]> = [
  ["color", "color"],
  ["backgroundColor", "background-color"],
  ["fontFamily", "font-family"],
  ["fontSize", "font-size"],
];

/** 把 textStyle 的样式属性拼成 CSS 声明串；没有任何样式时返回空串。 */
const textStyleCssDeclarations = (attributes: Record<string, unknown> | undefined): string =>
  TEXT_STYLE_CSS_PROPERTIES
    .map(([attribute, cssProperty]) => {
      const value = attributes?.[attribute];
      return typeof value === "string" && value.length > 0 ? `${cssProperty}: ${value}` : "";
    })
    .filter((declaration) => declaration.length > 0)
    .join("; ");

/*
 * textStyle 承载颜色、背景色、字体等样式，官方扩展却没有提供 renderMarkdown：
 * 由工具条加上（而不是写在 HTML 里）的样式会在序列化时整段丢掉，只剩文字。
 * 这里补上 `<span style="…">` 写法；HTML 写的 span 由
 * inlineHtmlSourceForm.ts 记录的原标签负责写回。
 */
const SerializableTextStyle = TextStyle.extend({
  renderMarkdown: (node, helpers) => {
    const declarations = textStyleCssDeclarations(node.attrs);
    const content = helpers.renderChildren(node);
    // 没有任何样式时不产出空 <span>，避免把纯文字凭空包一层标签。
    return declarations ? `<span style="${declarations}">${content}</span>` : content;
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
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute("data-xmd-code-pipe-styles");
          return value === null ? [] : JSON.parse(decodeURIComponent(value));
        },
        // 仅作为 Markdown 往返风格标记，不输出到编辑器 DOM。
        renderHTML: () => ({}),
      },
      delimiterWidths: {
        default: [],
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute("data-xmd-delimiter-widths");
          return value === null ? [] : JSON.parse(decodeURIComponent(value));
        },
        // 仅作为 Markdown 往返风格标记，不输出到编辑器 DOM。
        renderHTML: () => ({}),
      },
    };
  },

  parseMarkdown: (token, helpers) => {
    // 单元格结构与列对齐由官方 parseMarkdown 负责（它把 marked 的 table token 转成
    // tableRow / tableCell，并按 token.align 写入官方的 align 属性）；
    // 这里只在官方结果上补两个 Markdown 往返风格标记，避免把结构逻辑抄第二遍。
    const node = parseOfficialTableMarkdown(token, helpers);
    // raw 是表格在原文中的切片，用它还原用户手写的竖线转义风格与分隔行宽度。
    const rawMarkdown = String(token.raw ?? "");

    return {
      ...node,
      attrs: {
        ...node.attrs,
        codePipeStyles: getTableCodePipeStyles(rawMarkdown),
        delimiterWidths: getTableDelimiterWidths(rawMarkdown),
      },
    };
  },

  renderMarkdown: (node, helpers) => {
    const codePipeStyles = node.attrs?.codePipeStyles as boolean[][] | undefined;
    const delimiterWidths = node.attrs?.delimiterWidths as number[] | undefined;

    const rows: MarkdownTableCell[][] = (node.content ?? []).map((row, rowIndex) =>
      (row.content ?? []).map((cell, cellIndex) => {
        // 单元格内容是一串段落，逐个把段落的行内子节点交给官方渲染器，
        // 保证单元格内的加粗、链接等标记与正文共用同一套规则。
        // 必须渲染全部段落：合并单元格会把另一格的内容作为新段落并入本格，
        // 只渲染第一段会静默丢掉后面的内容（存盘后文字直接消失）。
        const paragraphs = (cell.content ?? []).map((paragraph) =>
          helpers.renderChildren(paragraph.content ?? []),
        );
        // Markdown 表格的一格写不下换行，段与段之间用行内 <br> 表示。
        // 并入空单元格时最后一段是空的，写成 <br> 只会在格尾留下无意义的换行。
        while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1] === "") paragraphs.pop();
        return {
          content: escapeTablePipes(
            restoreTableBackticks(paragraphs.join("<br>")),
            codePipeStyles?.[rowIndex]?.[cellIndex] === true,
          ),
          // 对齐存放在官方的 align 属性上，取值收敛到 Markdown 能表达的三种。
          alignment: toTableAlignment(cell.attrs?.align),
        };
      }),
    );

    return renderMarkdownTable(rows, delimiterWidths);
  },
});

// Markdown 中保存可迁移的相对路径，节点视图单独读取本地文件用于显示。
// 这样预览所需的 data URL 不会污染实际文档内容。
//
// 尺寸属性说明：Markdown 图片语法本身不表达尺寸，社区通行的做法是用 HTML 写
// `<img src="..." width="16" height="16">`（favicon、徽章等行内小图标尤其常见）。
// 因此 width 与 height 都要被节点接收并原样写回，否则用户写下的尺寸会被静默丢弃、
// 图片退化成自然尺寸（24×24 或 48×48 的图标放进正文会明显大于文字）。
//
// style 的处理与 Typora 一致：尺寸类声明（width/height/zoom）在编辑器里生效，
// 其余声明只影响导出，但整段 style 原文必须原样写回，否则用户的样式会静默丢失。
// 解析规则见 editor/imageStyle.ts。
const createLocalImage = (getCurrentDocumentPath?: () => string | null) =>
  Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        // 尺寸属性交给 imageStyle.readImageSizeAttribute：像素返回数字，`width="60%"`
        // 这类百分比原样保留成字符串（README 里很常见），其它写法一律视为没写。
        width: {
          default: null,
          parseHTML: (element) => readImageSizeAttribute(element.getAttribute("width")),
          renderHTML: (attributes) =>
            attributes.width ? { width: String(attributes.width) } : {},
        },
        height: {
          default: null,
          parseHTML: (element) => readImageSizeAttribute(element.getAttribute("height")),
          renderHTML: (attributes) =>
            attributes.height ? { height: String(attributes.height) } : {},
        },
        // style 原文：编辑器只让尺寸与 zoom 生效，但存盘必须逐字写回用户的 style。
        styleSource: {
          default: null,
          parseHTML: (element) => {
            const raw = element.getAttribute("style");
            return raw && raw.trim() !== "" ? raw : null;
          },
          renderHTML: () => ({}),
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

        // 右键菜单由 MarkdownEditor 用 Vue 渲染（需要确认弹窗与文件操作），
        // 这里只把事件连同图片地址抛出去，避免在节点视图里堆一套菜单 DOM。
        wrapper.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          wrapper.dispatchEvent(
            new CustomEvent("xmd-image-contextmenu", {
              bubbles: true,
              detail: {
                src: String(currentNode.attrs.src ?? ""),
                x: event.clientX,
                y: event.clientY,
              },
            }),
          );
        });

        const renderImage = (src: string, alt: string | null, title: string | null): void => {
          image.alt = alt ?? "";
          image.title = title ?? "";
          // 用户通过 HTML 属性指定的尺寸优先；属性没写时退回 style 里的尺寸，
          // 都没有就清空内联样式，交回全局图片样式（max-width:100%、height:auto）按自然比例显示。
          // 属性可能是像素数字，也可能是 `width="60%"` 这样的百分比字符串（README 常见写法）。
          const styleSource = (currentNode.attrs.styleSource as string | null) ?? null;
          const width = currentNode.attrs.width ?? readStylePixels(styleSource, "width");
          const height = currentNode.attrs.height ?? readStylePixels(styleSource, "height");
          image.style.width = toCssLength(width as number | string | null);
          image.style.height = toCssLength(height as number | string | null);
          // zoom 同样来自 style，直接作用在 DOM 上，存盘仍写原始 style 文本。
          const zoom = readStyleZoom(styleSource);
          image.style.zoom = zoom ? `${zoom}%` : "";
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
                // style 里的宽高同样会锁死比例，一起去掉（zoom 等其它声明保留）。
                styleSource: stripStyleSizes(currentNode.attrs.styleSource as string | null),
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
    // 带尺寸的图片使用 Markdown 兼容的 HTML 写法，重新打开后仍可继续调整。
    // width 与 height 必须一起写回，否则用户标注的行内图标尺寸会在存盘后丢失。
    renderMarkdown: (node) => {
      const source = String(node.attrs?.src ?? "").replaceAll('"', "&quot;");
      const alt = String(node.attrs?.alt ?? "").replaceAll('"', "&quot;");
      const title = node.attrs?.title
        ? ` title="${String(node.attrs.title).replaceAll('"', "&quot;")}"`
        : "";
      const width = node.attrs?.width ? ` width="${node.attrs.width}"` : "";
      const height = node.attrs?.height ? ` height="${node.attrs.height}"` : "";
      // style 原文逐字写回：编辑器只实现尺寸与 zoom，其余声明交给导出。
      const style = node.attrs?.styleSource
        ? ` style="${String(node.attrs.styleSource).replaceAll('"', "&quot;")}"`
        : "";

      if (width || height || style) {
        return `<img src="${source}" alt="${alt}"${title}${width}${height}${style}>`;
      }
      return `![${alt}](${source}${node.attrs?.title ? ` "${node.attrs.title}"` : ""})`;
    },
  });

// 主编辑器与导出用的隐藏渲染编辑器共用同一套扩展配置，
// 保证导出结果和所见即所得视图的解析、渲染行为完全一致。
export const createEditorExtensions = (options: {
  getCurrentDocumentPath?: () => string | null;
} = {}) => {
  const { getCurrentDocumentPath } = options;

  /*
   * 这几个补丁覆盖官方 MarkdownManager 的原型方法，必须在任何 Editor 被构造之前安装。
   *
   * `contentType: "markdown"` 的初始内容是由 Markdown 扩展在它自己的 onBeforeCreate 里
   * 解析的（@tiptap/markdown 的 onBeforeCreate），而扩展钩子按扩展数组顺序注册，
   * Markdown 排在 MarkdownEscapeRelaxer 之前；onCreate 更是异步派发的。
   * 因此只要把安装放进扩展钩子，进程里第一个打开的文档在解析时就没有补丁：
   * 字面 `<a/>` 会被官方静默丢掉，表现为「同一份文件第一次打开丢内容、之后再打开又正常」。
   *
   * createEditorExtensions 是所有编辑器的唯一入口，且一定先于 Editor 构造执行，
   * 放在这里就不依赖任何扩展顺序。
   */
  installMinimalTextEscaping();
  installLiteralInlineHtmlParsing();
  installInlineHtmlSourceFormSerialization();
  installHtmlEntityDecoding();
  // 块级 HTML 认领来的节点（居中的 div、<hr>）按用户写的标签写回，见 htmlBlockSourceForm.ts。
  installHtmlBlockSourceFormSerialization();

  return [
    StarterKit.configure({
      codeBlock: false, // 使用 CodeBlockLowlight 替代
      code: false, // 使用不会误删反引号前普通字符的行内代码扩展
      hardBreak: false, // 使用保留源码写法的硬换行扩展
      link: false, // v3 起 StarterKit 内置 Link，改用额外支持 title 属性的 LinkWithTitle
      underline: false, // v3 起 StarterKit 内置 Underline，改用下方显式注册的 Underline
      listKeymap: false, // v3 新增的列表快捷键会改变 Tab/Enter 语义，保持升级前行为
      trailingNode: false, // 末尾段落由 TrailingParagraph 统一负责，避免重复追加
      paragraph: false, // 改用 InlineImageParagraph：独占一段的图片留在段落里
    }),
    InlineImageParagraph,
    LiteralHardBreak,
    SafeInlineCode,
    InlineCodeOpeningBacktick,
    // 官方 Markdown 扩展通过 markedOptions 透传给 marked。
    // breaks 让普通文本中的单个换行也显示为换行，符合所见即所得的使用习惯。
    // 官方扩展不接管粘贴/复制（源码中无 paste/clipboard 处理），旧包的
    // transformPastedText / transformCopiedText 选项在官方 API 中不存在。
    Markdown.configure({
      markedOptions: {
        breaks: true,
        gfm: true,
      },
    }),
    // 序列化输出前放宽惰性转义（Typora 风格：两侧皆空白的 \* 不再转义）
    MarkdownEscapeRelaxer,
    RawMarkdownBlock,
    // 链接引用定义按原样保存，避免 baseline 对账失败与定义行丢失。
    LinkReferenceDefinition,
    // 扩展模块各自管理 Markdown 解析、可视化和序列化，便于独立维护或替换。
    HtmlBlockSourceForm,
    HtmlBlock.configure({ getCurrentDocumentPath: getCurrentDocumentPath ?? (() => null) }),
    // 分页符：编辑区显示可见标记，导出/打印时输出真正的分页元素。
    PageBreak,
    // 行内 HTML 保留用户写法：预览照常渲染成粗体/下划线等，源码与存盘文件按原标签输出。
    InlineHtmlSourceForm,
    // kbd/var/samp 这类「文本语义标签」渲染成真正的 HTML 元素，而不是露出尖括号。
    HtmlTextTag,
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
    TableCell,
    TableHeader,
    TableColumnAlignment,
    TrailingParagraph,
    ReadableGapCursor,
    ClickableBlockGap,
    BlockMarquee,
    SerializableHighlight.configure({
      multicolor: true,
    }),
    // 排版替换加一道 HTML 标签保护，避免智能引号污染属性值（详见 htmlSafeTypography.ts）。
    HtmlSafeTypography,
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
    SerializableTextStyle,
    // 这两个全局属性让 <span style="font-size/background-…"> 这类写法真正生效，
    // 与 Typora 的渲染一致（属性本身写回 Markdown 时仍按原标签保留）。
    BackgroundColor,
    FontSize,
    CompatibleTaskList,
    TaskItem.configure({
      nested: true,
    }),
    Video.configure({
      getCurrentDocumentPath: () => getCurrentDocumentPath?.() ?? null,
    }),
    VideoLinkParser,
    Attachment.configure({
      getCurrentDocumentPath: () => getCurrentDocumentPath?.() ?? null,
    }),
    AttachmentLinkParser,
    AttachmentTransfer,
    SectionCollapse,
    CodeOccurrenceHighlight,
    AiGhostMark.configure({
      ghostClass: "ai-ghost-content",
    }),
  ];
};
