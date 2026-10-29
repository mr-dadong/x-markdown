import { Node, mergeAttributes } from "@tiptap/core";

/**
 * 独立成段的 `<br />`。
 *
 * GitHub 把这一行渲染成一个换行间距，XMD 早先把它当字面源码显示。这里用原子节点承载：
 * 编辑区显示为固定高度的间距块，写回 Markdown 时输出用户原来的标签写法。
 *
 * 为什么不落成空段落：空段落会被 TrailingParagraph 与块间空行规则吃掉，
 * 用户写下的 `<br />` 无法稳定地往返。
 */
export const HtmlBreak = Node.create({
  name: "htmlBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      /** 用户写的原始标签；写回 Markdown 时逐字输出。 */
      source: { default: "<br />" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-xmd-html-break]",
        getAttrs: (element) =>
          element instanceof HTMLElement
            ? { source: element.getAttribute("data-source") ?? "<br />" }
            : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // source 只服务于 Markdown 往返，不进编辑器 DOM，也不进导出 HTML。
    const { source, ...rest } = HTMLAttributes;
    return [
      "div",
      mergeAttributes(rest, { "data-xmd-html-break": "", "data-source": String(source ?? "<br />") }),
      ["br"],
    ];
  },

  renderMarkdown: (node) => String(node.attrs?.source ?? "<br />"),
});
