import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent, MarkdownToken } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import HtmlBlockView from "./HtmlBlockView.vue";
import { renderBlockHtmlSubset } from "./htmlBlockRender";
import { createHtmlBlockClaimPlugin } from "./htmlBlockClaim";
import { stripTrailingNewlines } from "../shared/officialMarkdown";
import { readPageBreakStyle } from "./PageBreak";

/**
 * 普通 HTML 文本/标记应保持可编辑，只有带 style 的复杂 HTML 才隔离预览。
 * 这样 <p>、<div>、表格等标签仍在正文流里，用户可以直接继续输入和修改。
 */
const needsIsolatedHtmlPreview = (source: string): boolean =>
  /<style\b/iu.test(source);

// TipTap v3 会把扩展的 Options 泛型带进 Node 的公开类型，createEditorExtensions
// 的导出类型因此需要能具名引用它，必须显式导出。
export interface HtmlBlockOptions {
  getCurrentDocumentPath: () => string | null;
}

export const HtmlBlock = Node.create<HtmlBlockOptions>({
  name: "htmlBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      getCurrentDocumentPath: () => null,
    };
  },

  addAttributes() {
    return {
      source: { default: "<div>HTML 内容</div>" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre[data-xmd-html-block]",
        getAttrs: (element) => ({
          source: element instanceof HTMLElement ? element.textContent ?? "" : "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { source, ...attributes } = HTMLAttributes;
    return [
      "pre",
      mergeAttributes(attributes, {
        "data-xmd-html-block": "",
        class: "my-4 overflow-x-auto rounded-md border border-line bg-toolbar p-3 font-mono text-[13px] leading-5 text-secondary",
      }),
      String(source ?? ""),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(HtmlBlockView);
  },

  /*
   * 写完就变活：在渲染视图里敲完或粘贴进来的块级 HTML，一旦结构闭合就立刻按
   * Markdown 的规则认领成真正的节点（判定细节见 htmlBlockClaim.ts）。
   *
   * 不做这件事的话，键入时文档里是字面文字，而它的序列化结果与源码逐字节相同，
   * 视图同步会判定「内容没变」而跳过重新解析 —— 同一段内容要切换视图若干次后才
   * 突然变成 HTML 块，行为依赖切换次数；手写的多行 HTML 更是永远停在字面文本上。
   *
   * 解析走官方 Markdown 管理器，与打开文件时的解析是同一条路径，因此编辑期与
   * 打开时的渲染口径一致。
   */
  addProseMirrorPlugins() {
    return [
      createHtmlBlockClaimPlugin((source) => {
        const manager = this.editor.storage.markdown?.manager;
        if (!manager) return null;
        return (manager.parse(source).content ?? []) as JSONContent[];
      }),
    ];
  },

  /*
   * 直接接管 marked 的块级 `html` token：
   * - 块级 HTML 在 parseToken 里先查解析注册表，本 handler 会优先于官方兜底；
   * - 行内 HTML 在 parseInlineTokens 里有硬编码分支（MarkdownManager.ts:726），
   *   根本不查 handler，因此不会误伤段落里的行内标签。
   */
  markdownTokenName: "html",

  parseMarkdown: (token, helpers) => {
    const source = String(token.text ?? token.raw ?? "");
    // 分页符走专用节点：编辑区显示可见的虚线标记，导出时输出真正的分页元素。
    const pageBreakStyle = readPageBreakStyle(source);
    if (pageBreakStyle) {
      return {
        type: "pageBreak",
        attrs: { source: stripTrailingNewlines(source), style: pageBreakStyle },
      } as unknown as MarkdownToken;
    }
    // 只有带 style 的复杂 HTML 才原样保存为隔离预览块，不在正文里执行。
    if (needsIsolatedHtmlPreview(source)) {
      return { type: "htmlBlock", attrs: { source } };
    }

    /*
     * 普通块级 HTML：能被 schema 认领的排版子集（居中的 div、<hr>、<img>）转成真正的
     * 编辑器节点，README 这类文件在预览视图里才能和网页渲染一致。
     * 认领不了的部分整体交回下面的字面文本分支，内容一字不丢。
     *
     * 行内片段复用官方的行内 HTML 解析（它带上了本项目的字面文本补丁）：
     * 官方把 tokenizeInline 标成可选，但管理器一定提供（见 MarkdownManager.createParseHelpers）。
     */
    const tokenizeInline = helpers.tokenizeInline as (src: string) => MarkdownToken[];
    const rendered = renderBlockHtmlSubset(source, {
      parseInline: (html) => helpers.parseInline(tokenizeInline(html)),
    });
    if (rendered) return rendered as unknown as MarkdownToken;

    /*
     * 认领不了或本来就不是排版 HTML：落成可编辑的段落文本。
     *
     * 段落文本必须去掉块尾换行（marked 给块级 html token 的 text 带上了它们）：
     * ProseMirror 的 white-space: break-spaces 会把这个换行渲染成段落末尾的一个空行，
     * 于是连续几行 HTML 注释在编辑器里看起来被空行隔开。块间空行本来就由文档序列化
     * 时的 "\n\n" 负责（见 officialMarkdown.ts 的约定），这里与 rawMarkdownBlock、
     * htmlBlock 一样剥掉。
     */
    const literal = stripTrailingNewlines(source);
    return {
      type: "paragraph",
      content: [{ type: "text", text: literal }],
    } as unknown as MarkdownToken;
  },

  // 原始 HTML 不做格式化，避免所见即所得视图改写用户的标签和属性。
  renderMarkdown: (node) => stripTrailingNewlines(String(node.attrs?.source ?? "")),
});
