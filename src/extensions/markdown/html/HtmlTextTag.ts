import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * 行内 HTML 的「文本语义标签」：`<kbd>`、`<var>`、`<samp>`、`<cite>`、`<dfn>`、
 * `<abbr>`、`<small>`、`<ins>`、`<q>`。
 *
 * 这些标签有两个共同点，所以可以只用一个标记来承载：
 * 1. 自身没有子结构（不像 `<ruby>`/`<rt>` 需要真正的节点模型）；
 * 2. 浏览器对它们就有默认样式，因此「把标签名原样渲染成一个元素」就能得到与
 *    Typora 一致的观感 —— Typora 会把常见 HTML 标签渲染成 HTML 内容
 *    （见 https://support.typora.io/HTML/ 的 Inline HTML 一节），而不是把
 *    `<kbd>Ctrl</kbd>` 当成一串字面文字显示。
 *
 * 写回 Markdown 时优先使用 inlineHtmlSourceForm.ts 记录的开标签，所以用户写
 * `<KBD>`、`<kbd class="x">` 都会照原样保留；没有记录（例如粘贴进来的加粗文本）
 * 时按标签名重建。
 *
 * 渲染时只输出标签本身，`class`/`id`/`data-*` 等属性不进入编辑器 DOM ——
 * 这与 Typora 的规则一致（这些属性渲染时忽略、导出时保留），也避免用户写的
 * class 意外命中编辑器自己的样式。
 *
 * 刻意不含 `<span>` 与 `<a>`：它们目前走「认不出的标签保留为字面文本」这条既有路径，
 * 改成渲染属于另一档改动（会把标签从预览里藏起来），不在本次范围内。
 */
const TEXT_TAGS = ["kbd", "var", "samp", "cite", "dfn", "abbr", "small", "ins", "q"];

export const HtmlTextTag = Mark.create({
  name: "htmlTextTag",

  addAttributes() {
    return {
      /** 渲染用的标签名；仅用于编辑器 DOM，不写进 Markdown（写回由原标签负责）。 */
      tag: {
        default: "kbd",
        parseHTML: (element) => element.nodeName.toLowerCase(),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return TEXT_TAGS.map((tag) => ({ tag }));
  },

  renderHTML({ mark, HTMLAttributes }) {
    return [String(mark.attrs.tag), mergeAttributes(HTMLAttributes), 0];
  },

  renderMarkdown: (node, helpers) => {
    const tag = String(node.attrs?.tag ?? "kbd");
    return `<${tag}>${helpers.renderChildren(node)}</${tag}>`;
  },
});
