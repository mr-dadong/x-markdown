import { Node } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import HtmlDetailsView from "./HtmlDetailsView.vue";
import { summaryPlainText } from "./htmlContainerSource";

/**
 * 块级 HTML 折叠容器：`<details>`、`<summary>…</summary>`、空行、Markdown 正文、空行、`</details>`。
 *
 * 编辑器内用 NodeView 渲染成「只读摘要行 + 常显内容区」：原生 `<details>` 折叠后内容
 * 不可编辑，折叠控件还会把焦点从编辑器里抢走。折叠状态只保存在 attrs 里，
 * 导出 HTML 与隔离预览时才输出原生 `<details open?>` 结构。
 */

export const HtmlDetails = Node.create({
  name: "htmlDetails",
  group: "block",
  content: "block+",
  // 面板是内容的框架，编辑内容时不应该被整体替换掉。
  defining: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      /** 用户写的 summary 行原文（含 `<summary>` 标签）；为空时导出空摘要。 */
      summarySource: { default: "" },
      /** 源码里是否带 `open` 属性；只影响导出与预览。 */
      open: { default: false },
      /** 用户写的开标签原文。 */
      openSource: { default: null },
      /** 用户写的闭标签原文。 */
      closeSource: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "details",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            summarySource: element.querySelector("summary")?.outerHTML ?? "",
            open: element.hasAttribute("open"),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // summarySource 只服务于 Markdown 往返；导出 HTML 里输出语义化的 summary + 正文。
    const {
      summarySource,
      openSource: _openSource,
      closeSource: _closeSource,
      open,
      ...rest
    } = HTMLAttributes;

    /*
     * ProseMirror 的数组形态不允许「静态节点 + 内容洞」并列，而 details 必须是
     * summary 在前、正文在后，所以这里用 { dom, contentDOM } 自己搭结构：
     * summary 是静态标题，正文放进内层容器，由编辑器接管。
     */
    const details = document.createElement("details");
    if (open) details.setAttribute("open", "");
    for (const [name, value] of Object.entries(rest)) {
      if (value == null || value === false) continue;
      details.setAttribute(name, String(value));
    }

    const summary = document.createElement("summary");
    summary.textContent = summaryPlainText(String(summarySource ?? ""));
    details.append(summary);

    const body = document.createElement("div");
    details.append(body);

    return { dom: details, contentDOM: body };
  },

  addNodeView() {
    return VueNodeViewRenderer(HtmlDetailsView);
  },

  /*
   * 写回 Markdown：开标签、summary 行、空行、正文、空行、闭标签。
   * 这个形态既符合 GitHub 的语义（空行后的内容才按 Markdown 解析），
   * 也能被解析器再次认领成同一个节点。未改动的面板由增量保存逐字节还原原文。
   */
  renderMarkdown: (node, helpers) => {
    const attrs = node.attrs ?? {};
    const openSource = String(attrs.openSource ?? "") || (attrs.open ? "<details open>" : "<details>");
    const closeSource = String(attrs.closeSource ?? "") || "</details>";
    const summary = String(attrs.summarySource ?? "").trim();
    const head = summary === "" ? openSource : `${openSource}\n${summary}`;
    const body = helpers.renderChildren(node, "\n\n").replace(/\n+$/u, "");
    return body === "" ? `${head}${closeSource}` : `${head}\n\n${body}\n\n${closeSource}`;
  },
});
