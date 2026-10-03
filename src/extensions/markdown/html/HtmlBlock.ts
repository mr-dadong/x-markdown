import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent, MarkdownToken } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import HtmlBlockView from "./HtmlBlockView.vue";
import { renderBlockHtmlSubset } from "./htmlBlockRender";
import { createHtmlBlockClaimPlugin, scanLineDepths } from "./htmlBlockClaim";
import { neverInterruptParagraph, stripTrailingNewlines, takeBlockRaw } from "../shared/officialMarkdown";
import { readPageBreakStyle } from "./PageBreak";

/**
 * 简单 HTML 沿用正文编辑，嵌套容器、表格和样式块使用完整隔离预览。
 * 复杂排版的源码保存在节点属性中，用户在源码模式修改。
 */
const needsIsolatedHtmlPreview = (source: string): boolean => {
  if (/<style\b/iu.test(source)) return true;
  // 嵌套段落、表格和列表需要完整 HTML 排版，不能压成一个编辑器段落。
  const document = new DOMParser().parseFromString(source, "text/html");
  return document.body.querySelector("div p, div div, table, ul, ol, section, article") !== null;
};

/** 完整 HTML 容器跨空行读取，避免 README 的图片和徽章被拆成源码段落。 */
const tokenizeCompleteHtml = (source: string): MarkdownToken | undefined => {
  if (!/^ {0,3}<(?:div|p|center|table|ul|ol|section|article)\b/iu.test(source)) return undefined;
  const lines = source.split("\n");
  const depths = scanLineDepths(source);
  const end = depths.findIndex((depth) => depth === 0);
  if (end < 0) return undefined;
  const raw = takeBlockRaw(lines, end + 1);
  if (!needsIsolatedHtmlPreview(raw)) return undefined;
  const document = new DOMParser().parseFromString(raw, "text/html");
  // 容器直接夹着 Markdown 正文时仍按 Markdown 分块，避免吞掉表格、标题等语法。
  for (const container of document.body.querySelectorAll("div, center, section, article")) {
    if (Array.from(container.childNodes).some((child) => child.nodeType === 3 && child.textContent?.trim())) return undefined;
  }
  return { type: "html", raw, text: raw };
};

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

  // 与普通 HTML 共用解析入口，仅提前认领需要完整预览的闭合容器。
  markdownTokenizer: {
    name: "html",
    level: "block",
    start: neverInterruptParagraph,
    tokenize: tokenizeCompleteHtml,
  },

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
    // 复杂 HTML 原样保存为隔离预览块，保留嵌套结构、属性与块内空行。
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
