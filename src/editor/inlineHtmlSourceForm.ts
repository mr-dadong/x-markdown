import { Extension } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

/**
 * 行内 HTML 的源码形态保真。
 *
 * 问题：Markdown 里的行内 HTML（`<b>222</b>`、`<u>x</u>`、`<span style="color:red">x</span>`）
 * 会被 schema 认领成对应的标记，而标记默认按 Markdown 的等价写法输出 —— 用户写下的
 * `<b>222</b>` 存盘时被改写成 `**222**`，`<span style="color:red">` 的颜色甚至会被整段丢掉。
 *
 * 做法：给这些标记与节点加一个只用于 Markdown 往返的属性，记住「用户是用哪段开标签写的」。
 * - 解析：只在解析 Markdown 行内 HTML 时记录（开关由 markdownInlineHtmlLiteral.ts 打开），
 *   粘贴 HTML、工具栏加粗等路径都不记录，行为与改动前一致；
 * - 序列化：有记录时原样输出 `<b>…</b>`，没有记录时仍走官方与各扩展自己的 Markdown 写法。
 *
 * 结果是预览视图照常把标签渲染成真正的粗体/下划线/颜色，源码视图与存盘文件保留用户写法，
 * 且往返稳定：`<b>x</b>` 存盘再打开仍然是 `<b>x</b>`。
 */

/** 记录行内 HTML 开标签的属性名。 */
export const INLINE_HTML_OPEN_ATTRIBUTE = "xmdHtmlOpen";

/**
 * 需要记住源码形态的类型，都是能被行内 HTML 认领成「格式」的标记与节点。
 *
 * 刻意不含 link 与 image：`<a href>` 与 `<img>` 表达的是内容本身（链接、图片），
 * 仍按 Markdown 语法转换；只有纯格式标签才保留 HTML 写法。
 */
const INLINE_HTML_TYPES = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "highlight",
  "subscript",
  "superscript",
  "textStyle",
  "htmlTextTag",
  "hardBreak",
];

/** 当前是否正在解析 Markdown 里的行内 HTML；只有这时才记录源码形态。 */
let parsingInlineHtmlFromMarkdown = false;

/**
 * 在「正在解析 Markdown 行内 HTML」的开关下执行解析。
 *
 * 官方 parseHTMLToken 内部同步调用 generateJSON，全局属性据此判断要不要记录。
 */
export const runWithInlineHtmlSourceForm = <T>(work: () => T): T => {
  const previous = parsingInlineHtmlFromMarkdown;
  parsingInlineHtmlFromMarkdown = true;
  try {
    return work();
  } finally {
    parsingInlineHtmlFromMarkdown = previous;
  }
};

/** 把 DOM 元素还原成开标签文本；属性值里的双引号写成实体，保证输出仍是合法 HTML。 */
const openTagOfElement = (element: Element): string => {
  const name = element.nodeName.toLowerCase();
  const attributes = Array.from(element.attributes)
    .map((attribute) => ` ${attribute.name}="${attribute.value.replaceAll('"', "&quot;")}"`)
    .join("");
  return `<${name}${attributes}>`;
};

/** 从开标签文本取出标签名，用于拼出闭标签。 */
const tagNameOfOpenTag = (openTag: string): string => {
  const match = /^<\s*([A-Za-z][\w-]*)/u.exec(openTag);
  if (!match) throw new Error(`行内 HTML 开标签缺少标签名：${openTag}`);
  return match[1];
};

/** 声明「行内 HTML 源码形态」属性。 */
export const InlineHtmlSourceForm = Extension.create({
  name: "inlineHtmlSourceForm",

  addGlobalAttributes() {
    return [
      {
        types: INLINE_HTML_TYPES,
        attributes: {
          [INLINE_HTML_OPEN_ATTRIBUTE]: {
            default: null,
            // 只认 Markdown 行内 HTML 的解析过程：粘贴 HTML 时开关是关的，不会记录。
            parseHTML: (element) =>
              parsingInlineHtmlFromMarkdown ? openTagOfElement(element) : null,
            // 只用于 Markdown 往返，不写进编辑器 DOM，也不进入导出的 HTML。
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },
});

/** 官方 MarkdownManager 内部使用、但未公开导出的方法签名。 */
type MarkLike = { attrs?: Record<string, unknown> } | undefined;

type MarkdownManagerMarkSerialization = {
  getMarkOpening: (markType: string, mark: MarkLike, openingMode?: string) => string;
  getMarkClosing: (markType: string, mark: MarkLike, openingMode?: string) => string;
};

/** 取标记上记录的原始开标签；没有记录时返回 null，交回官方与各扩展的 Markdown 写法。 */
const recordedOpenTag = (mark: MarkLike): string | null => {
  const value = mark?.attrs?.[INLINE_HTML_OPEN_ATTRIBUTE];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/** 是否已经打过补丁，避免重复安装时把覆盖层层叠加。 */
let serializationPatched = false;

/**
 * 让带源码形态的标记按用户写的 HTML 输出。
 *
 * 覆盖的是原型上的取开/闭标签方法，因此对已经创建的 manager 实例同样生效；
 * 函数幂等，重复调用不会重复包装。必须在任何 Editor 构造之前调用
 * （与另外两个 MarkdownManager 补丁同样的原因，见 editorExtensions.ts）。
 */
export const installInlineHtmlSourceFormSerialization = (): void => {
  if (serializationPatched) return;
  serializationPatched = true;

  const prototype = MarkdownManager.prototype as unknown as MarkdownManagerMarkSerialization;
  const originalGetMarkOpening = prototype.getMarkOpening;
  const originalGetMarkClosing = prototype.getMarkClosing;

  prototype.getMarkOpening = function (
    this: MarkdownManagerMarkSerialization,
    markType: string,
    mark: MarkLike,
    openingMode = "markdown",
  ): string {
    const openTag = recordedOpenTag(mark);
    if (openTag) return openTag;
    return originalGetMarkOpening.call(this, markType, mark, openingMode);
  };

  prototype.getMarkClosing = function (
    this: MarkdownManagerMarkSerialization,
    markType: string,
    mark: MarkLike,
    openingMode = "markdown",
  ): string {
    const openTag = recordedOpenTag(mark);
    if (openTag) return `</${tagNameOfOpenTag(openTag)}>`;
    return originalGetMarkClosing.call(this, markType, mark, openingMode);
  };
};
