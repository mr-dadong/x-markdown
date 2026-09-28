import { Node, mergeAttributes } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import PageBreakView from "./PageBreakView.vue";

/*
 * 分页符：与 Typora 一致，用一段 HTML 表达「这里分页」——
 *   <div style="page-break-after: always"></div>
 * 打印/导出时它本身不占可见空间，只在编辑区显示一条带文字的虚线，方便定位与删除。
 *
 * 官方 HtmlBlock 会把带 style 的块级 HTML 收进隔离预览，那样用户既看不见分页符，
 * 也以为只是一段普通 HTML；这里在 HtmlBlock 的解析分支里把它单独识别出来。
 */

/** 独占一段的 `<div style="..."></div>`，属性值允许单引号、双引号或不加引号。 */
const DIV_WITH_STYLE_PATTERN = /^<div\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))\s*>\s*<\/div>$/iu;

/** style 里是否声明了分页。 */
const PAGE_BREAK_DECLARATION_PATTERN = /(?:^|;)\s*page-break-(?:after|before)\s*:\s*always\s*(?:;|$)/iu;

/** 从 HTML 里取出 style 声明文本；不是分页符写法时返回 null。 */
export const readPageBreakStyle = (source: string): string | null => {
  const match = source.trim().match(DIV_WITH_STYLE_PATTERN);
  if (!match) return null;
  const styleText = match[1] ?? match[2] ?? match[3] ?? "";
  return PAGE_BREAK_DECLARATION_PATTERN.test(styleText) ? styleText.trim() : null;
};

export interface PageBreakOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const PageBreak = Node.create<PageBreakOptions>({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      // 用户写的原始标签：序列化时逐字写回。
      source: { default: '<div style="page-break-after: always"></div>' },
      // 原始 style 声明，用于导出时生成真正参与打印的分页元素。
      style: { default: "page-break-after: always" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-xmd-page-break]" }];
  },

  /*
   * 导出用的隐藏编辑器不会渲染 Vue 节点视图（见 useExport 的说明），
   * 因此这里必须输出真正的分页元素，编辑区那条虚线由节点视图负责。
   */
  renderHTML({ HTMLAttributes }) {
    // source 只用于 Markdown 序列化，这里解构出来是为了不把它透传到 DOM 属性上。
    const { source: _source, style, ...attributes } = HTMLAttributes;
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, attributes, {
        "data-xmd-page-break": "",
        style: String(style ?? "page-break-after: always"),
      }),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(PageBreakView);
  },

  renderMarkdown: (node) => String(node.attrs?.source ?? ""),
});
