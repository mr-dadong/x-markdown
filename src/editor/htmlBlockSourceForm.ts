import { Extension } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/core";

/**
 * 块级 HTML 的源码形态保真。
 *
 * 背景：Markdown 里的块级 HTML 一旦被认领成真正的编辑器节点（居中的 `<div>`、`<hr>`、
 * 行内 `<img>`），就会按 Markdown 自己的写法输出 —— `<div align="center">` 变成一个
 * 普通居中段落、`<hr>` 变成 `---`，用户写下的 HTML 在存盘时被悄悄改掉。
 *
 * 做法与行内 HTML 一致（见 inlineHtmlSourceForm.ts）：解析块级 HTML 时把用户写的开标签
 * 记在节点属性上，序列化时按原标签包回去。属性只用于 Markdown 往返，不写进编辑器 DOM，
 * 也不进入导出的 HTML。
 *
 * 增量保存（sourcePreservingSerializer.ts）对没改动过的块仍是逐字节还原原文，
 * 因此这些属性只在用户真的编辑过该块时才起作用。
 */

/** 记录块级 HTML 开标签的属性名。 */
export const HTML_BLOCK_OPEN_ATTRIBUTE = "xmdHtmlBlockOpen";

/**
 * 同一个 Markdown 块产出的多个节点共用的分组编号。
 *
 * 一个块级 HTML 块可能产出多个节点：`<div align="center">…</div>` + `<hr>` + 第二个
 * `<div>` 在源码里是同一个块。增量保存必须把它们当同一个源码块处理，否则未改动的内容
 * 会被重新插入一遍、在文件里重复。
 */
export const HTML_BLOCK_CHUNK_ATTRIBUTE = "xmdHtmlChunk";

/**
 * 只有开标签、没有子内容的元素。
 *
 * 这些标签的节点只输出用户写的那段标签：`<hr>` 认领来的分隔线不能写成 `---`，
 * 也不能在它后面再补一个不存在的闭标签。
 */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** 从开标签文本取出标签名，用于拼出闭标签。 */
const tagNameOfOpenTag = (openTag: string): string => {
  const match = /^<\s*([A-Za-z][\w-]*)/u.exec(openTag);
  if (!match) throw new Error(`块级 HTML 开标签缺少标签名：${openTag}`);
  return match[1];
};

/**
 * 按记录的 HTML 开标签包住节点自己的 Markdown。
 *
 * 没有记录时原样返回：用户在编辑器里直接打出来的居中段落、分隔线不受影响，
 * 行为与改动前一致。
 */
export const wrapMarkdownWithHtmlBlock = (
  attributes: Record<string, unknown> | undefined,
  inner: string,
): string => {
  const openTag = attributes?.[HTML_BLOCK_OPEN_ATTRIBUTE];
  if (typeof openTag !== "string" || openTag === "") return inner;

  const tagName = tagNameOfOpenTag(openTag).toLowerCase();
  // 自闭合元素（`<hr>`）：节点内容（分隔线的 `---`）不写回，只输出用户写的标签。
  if (VOID_TAGS.has(tagName)) return openTag;
  // 内容为空（例如空的居中容器）时写成单行，避免留下两行空行。
  if (inner.trim() === "") return `${openTag}</${tagName}>`;
  return `${openTag}\n${inner}\n</${tagName}>`;
};

/**
 * 声明块级 HTML 的源码形态属性。
 *
 * 只挂在会被块级 HTML 认领的节点上，避免给所有节点都加两个无意义属性。
 */
export const HtmlBlockSourceForm = Extension.create({
  name: "htmlBlockSourceForm",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "horizontalRule"],
        attributes: {
          [HTML_BLOCK_OPEN_ATTRIBUTE]: {
            default: null,
            // 只用于 Markdown 往返，不写进编辑器 DOM，也不进入导出的 HTML。
            renderHTML: () => ({}),
          },
          [HTML_BLOCK_CHUNK_ATTRIBUTE]: {
            default: null,
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },
});

/** 官方 MarkdownManager 内部使用、但未出现在公开类型里的方法。 */
type MarkdownManagerNodeSerialization = {
  /** 把一个节点渲染成 Markdown；节点自己的扩展处理器在这一层被调用。 */
  renderNodeToMarkdown: (
    node: JSONContent,
    parentNode?: JSONContent | null,
    index?: number,
    level?: number,
    meta?: Record<string, unknown>,
  ) => string;
};

/** 是否已经打过补丁，避免重复安装时把覆盖层层叠加。 */
let serializationPatched = false;

/**
 * 让带源码形态的节点按用户写的 HTML 标签包住自己的 Markdown。
 *
 * 覆盖的是原型方法，因此对已经创建的 manager 实例同样生效；函数幂等，重复调用不会
 * 重复包装。必须在任何 Editor 被构造之前调用（与另外几个 MarkdownManager 补丁同样的
 * 原因，见 editorExtensions.ts）。
 *
 * 这里用原型补丁而不是给段落/分隔线各写一个 renderMarkdown：官方没有提供「渲染完再包一层」
 * 的钩子，逐个扩展复制一遍渲染实现反而更容易和官方行为走偏。
 */
export const installHtmlBlockSourceFormSerialization = (): void => {
  if (serializationPatched) return;
  serializationPatched = true;

  const prototype = MarkdownManager.prototype as unknown as MarkdownManagerNodeSerialization;
  const originalRenderNode = prototype.renderNodeToMarkdown;

  prototype.renderNodeToMarkdown = function (
    this: MarkdownManagerNodeSerialization,
    node: JSONContent,
    parentNode?: JSONContent | null,
    index?: number,
    level?: number,
    meta?: Record<string, unknown>,
  ): string {
    const inner = originalRenderNode.call(this, node, parentNode, index, level, meta);
    return wrapMarkdownWithHtmlBlock(node?.attrs, inner);
  };
};
