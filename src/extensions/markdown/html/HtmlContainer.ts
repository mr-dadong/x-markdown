import { Node, mergeAttributes } from "@tiptap/core";
import { normalizeHtmlAlignment, openTagOfAlignment } from "./htmlContainerSource";

/**
 * 块级 HTML 对齐容器：`<div align="center">`、空行、Markdown 正文、空行、`</div>`。
 *
 * 为什么需要独立节点：GitHub 用 HTML 解析器把未闭合标签自动配平，开标签之后的若干
 * Markdown 块天然成为它的子节点；ProseMirror 的文档必须是配平的树，只有把整段容器
 * 认领成一个带 block 内容的节点，跨空行的居中排版才能既渲染又编辑。
 *
 * 开/闭标签原文记录在 attrs 上，写回 Markdown 时按用户写法输出。对齐只作用在容器自身
 * （`align` 属性会被浏览器继承到子块），不给子块写 textAlign —— 子块属性一旦被污染，
 * Markdown 往返与增量保存都会跟着抖动。
 */

export const HtmlContainer = Node.create({
  name: "htmlContainer",
  group: "block",
  content: "block+",
  // 与引用一致：容器是内容的框架，编辑时不应该被整体替换掉。
  defining: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      /** 对齐方式；null 表示没有可识别的对齐信息。 */
      align: { default: null },
      /** 用户写的开标签原文；来自粘贴时为空，写回时按 align 合成。 */
      openSource: { default: null },
      /** 用户写的闭标签原文；同上。 */
      closeSource: { default: null },
    };
  },

  parseHTML() {
    const alignmentOf = (element: Element): string | null =>
      normalizeHtmlAlignment(element.getAttribute("align"));

    return [
      {
        tag: "div[align]",
        getAttrs: (element) =>
          element instanceof HTMLElement ? { align: alignmentOf(element) } : false,
      },
      {
        tag: "p[align]",
        getAttrs: (element) =>
          element instanceof HTMLElement ? { align: alignmentOf(element) } : false,
      },
      {
        tag: "center",
        getAttrs: () => ({ align: "center" }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // openSource / closeSource 只服务于 Markdown 往返，不进编辑器 DOM，也不进导出 HTML。
    const { align, openSource: _openSource, closeSource: _closeSource, ...rest } = HTMLAttributes;
    const value = normalizeHtmlAlignment(align);
    return ["div", mergeAttributes(rest, value ? { align: value } : {}), 0];
  },

  /*
   * 写回 Markdown：开标签与正文之间必须留空行，否则后续内容会被当成原始 HTML，
   * 而不是按 Markdown 解析 —— 这也正是重新打开文件时能被再次认领的形态。
   * 未改动的容器由增量保存逐字节还原原文，这里只在用户真的编辑过时生效。
   */
  renderMarkdown: (node, helpers) => {
    const openSource =
      String(node.attrs?.openSource ?? "") || openTagOfAlignment(normalizeHtmlAlignment(node.attrs?.align));
    const closeSource = String(node.attrs?.closeSource ?? "") || "</div>";
    const body = helpers.renderChildren(node, "\n\n").replace(/\n+$/u, "");
    return body === "" ? `${openSource}${closeSource}` : `${openSource}\n\n${body}\n\n${closeSource}`;
  },
});
