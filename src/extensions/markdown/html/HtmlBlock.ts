import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownToken } from "@tiptap/core";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import HtmlBlockView from "./HtmlBlockView.vue";
import { stripTrailingNewlines } from "../shared/officialMarkdown";

// 独占一行的单个 img 属于图片内容，不需要套用通用 HTML iframe 预览。
const isStandaloneImageHtml = (source: string): boolean =>
  /^\s*<img\b[^>]*>\s*$/iu.test(source);

/** 读取 HTML 标签上的属性（双引号或单引号写法都支持）。 */
const readHtmlAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return attributes;
};

/** 只接受正整数像素值，解析不到合法数值时返回 null。 */
const parsePixelValue = (raw: string | undefined): number | null => {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * 把独占一行的 `<img>` 还原成图片节点。
 * 旧实现靠 markdown-it 输出 `<p><img ...></p>` 再交给图片扩展解析，
 * 官方管线里块级 HTML 直接进本 handler，因此这里显式构造图片节点，
 * 保证 width / height 等属性不会丢失。
 */
const imageNodeFromHtml = (source: string): MarkdownToken | undefined => {
  const attributes = readHtmlAttributes(source);
  const src = attributes.src ?? "";
  if (!src) return undefined;

  return {
    type: "paragraph",
    content: [
      {
        type: "image",
        attrs: {
          src,
          alt: attributes.alt ?? null,
          title: attributes.title ?? null,
          width: parsePixelValue(attributes.width),
          height: parsePixelValue(attributes.height),
        },
      },
    ],
  } as unknown as MarkdownToken;
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
   * 直接接管 marked 的块级 `html` token：
   * - 块级 HTML 在 parseToken 里先查解析注册表，本 handler 会优先于官方兜底；
   * - 行内 HTML 在 parseInlineTokens 里有硬编码分支（MarkdownManager.ts:726），
   *   根本不查 handler，因此不会误伤段落里的行内标签。
   */
  markdownTokenName: "html",

  parseMarkdown: (token) => {
    const source = String(token.text ?? token.raw ?? "");
    // 独占一行的图片走图片节点，其余 HTML 原样保存为源码块，绝不在编辑器里直接执行。
    if (isStandaloneImageHtml(source)) {
      const image = imageNodeFromHtml(source);
      if (image) return image;
    }
    return { type: "htmlBlock", attrs: { source } };
  },

  // 原始 HTML 不做格式化，避免所见即所得视图改写用户的标签和属性。
  renderMarkdown: (node) => stripTrailingNewlines(String(node.attrs?.source ?? "")),
});
