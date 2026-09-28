import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent, MarkdownToken } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import HtmlBlockView from "./HtmlBlockView.vue";
import { stripTrailingNewlines } from "../shared/officialMarkdown";
import { readPageBreakStyle } from "./PageBreak";

// 独占一行的单个 img 属于图片内容，不需要套用通用 HTML iframe 预览。
const isStandaloneImageHtml = (source: string): boolean =>
  /^\s*<img\b[^>]*>\s*$/iu.test(source);

/**
 * 普通 HTML 文本/标记应保持可编辑，只有带 style 的复杂 HTML 才隔离预览。
 * 这样 <p>、<div>、表格等标签仍在正文流里，用户可以直接继续输入和修改。
 */
const needsIsolatedHtmlPreview = (source: string): boolean =>
  /<style\b/iu.test(source);

/**
 * 粗筛「整段文本就是一个带闭合标签的元素」，只是廉价前置条件。
 *
 * 这段文本到底会不会变成 HTML（块级还是行内、还是压根没变化）由解析器判定，
 * 见 parseHtmlAsTyped。要求闭合标签，是为了避免 `<p>` 刚敲出开标签就被处理、
 * 导致后面的内容没处输入。
 */
const COMPLETE_ELEMENT_PATTERN = /^<([A-Za-z][\w-]*)(?:\s[^<>]*)?>[\s\S]*<\/\1>$/u;

/**
 * 判断解析结果是否与「原样的字面文字」完全相同。
 *
 * `<span>sss</span>`、`<a>sss</a>` 这类 schema 认不出的标签，解析后仍然是一段
 * 纯文字，和直接输入没有区别 —— 这种情况不该替换，交给正常输入即可。
 */
const isLiteralText = (nodes: readonly JSONContent[], source: string): boolean => {
  if (nodes.length !== 1 || nodes[0].type !== "paragraph") return false;
  const content = nodes[0].content ?? [];
  if (content.length !== 1) return false;
  const only = content[0];
  return (
    only.type === "text"
    && (only.marks ?? []).length === 0
    && String(only.text ?? "") === source
  );
};

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
   * 键入即变活：在渲染视图里敲完 `</p>` 的瞬间就把整段转成 HTML 块。
   *
   * 不加这条规则的话，键入时文档里是字面文字，而它的序列化结果与源码逐字节相同，
   * 视图同步会判定「内容没变」而跳过重新解析 —— 于是同一段内容在切换视图若干次后才
   * 突然变成 HTML 块，行为依赖切换次数。这里让转换在键入时就发生，消掉这个不确定态。
   */
  addInputRules() {
    return [
      new InputRule({
        find: COMPLETE_ELEMENT_PATTERN,
        handler: ({ state, range, match }) => {
          const manager = this.editor.storage.markdown?.manager;
          if (!manager) return null;

          const source = match[0];
          const $from = state.doc.resolve(range.to);
          // 只处理顶层段落：嵌套在列表/引用里的情况交给重新解析，避免破坏容器结构。
          if ($from.depth !== 1) return null;

          /*
           * 输入规则在字符真正插入文档之前运行，所以段落里还差刚敲下的那个字符：
           * 此时段落文本是匹配结果的前缀（`<p>ddd</p` 对 `<p>ddd</p>`）。
           * 前缀成立即说明整段就是这段 HTML，替换不会吃掉同段里的其它文字；
           * 被吸收的那个字符也不会再单独插入，因为它已经被这次输入消费掉了。
           */
          if (!source.startsWith($from.parent.textContent)) return null;

          /*
           * 直接拿解析器的结果替换当前段落，而不是自己判断块级还是行内：
           * `<p>ddd</p>` 解析成 HTML 块，`<em>x</em>` 解析成斜体文字，
           * 两者都当场生效，与重新解析的结果天然一致。
           */
          const parsed = (manager.parse(source).content ?? []) as JSONContent[];
          if (parsed.length === 0 || isLiteralText(parsed, source)) return null;

          const nodes = parsed.map((node) => state.schema.nodeFromJSON(node));
          const insertedSize = nodes.reduce((total, node) => total + node.nodeSize, 0);
          const start = $from.before($from.depth);
          const end = $from.after($from.depth);
          state.tr.replaceWith(start, end, nodes);

          const last = nodes[nodes.length - 1];
          if (last.isTextblock) {
            /*
             * 解析结果本身就是可输入的段落（行内 HTML，如 `<em>x</em>` 变斜体文字）：
             * 光标直接落到它的末尾，不需要额外补段落。
             */
            state.tr.setSelection(
              TextSelection.create(state.tr.doc, start + insertedSize - 1),
            );
          } else {
            /*
             * 结尾是 HTML 块这类原子节点：光标必须落在可输入的文本块里，否则会变成
             * 节点选区，用户一敲字就把整个块替换掉。后面没有文本块时补一个空段落。
             */
            const after = start + insertedSize;
            if (!state.tr.doc.resolve(after).parent.inlineContent) {
              state.tr.insert(after, state.schema.nodes.paragraph.create());
            }
            state.tr.setSelection(TextSelection.near(state.tr.doc.resolve(after)));
          }
        },
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

  parseMarkdown: (token) => {
    const source = String(token.text ?? token.raw ?? "");
    // 独占一行的图片走图片节点。
    if (isStandaloneImageHtml(source)) {
      const image = imageNodeFromHtml(source);
      if (image) return image;
    }
    // 分页符走专用节点：编辑区显示可见的虚线标记，导出时输出真正的分页元素。
    const pageBreakStyle = readPageBreakStyle(source);
    if (pageBreakStyle) {
      return {
        type: "pageBreak",
        attrs: { source: stripTrailingNewlines(source), style: pageBreakStyle },
      } as unknown as MarkdownToken;
    }
    // 普通 HTML 不进隔离块，直接落成可编辑的段落文本。
    if (!needsIsolatedHtmlPreview(source)) {
      return {
        type: "paragraph",
        content: [{ type: "text", text: source }],
      } as unknown as MarkdownToken;
    }
    // 只有带 style 的复杂 HTML 才原样保存为隔离预览块。
    return { type: "htmlBlock", attrs: { source } };
  },

  // 原始 HTML 不做格式化，避免所见即所得视图改写用户的标签和属性。
  renderMarkdown: (node) => stripTrailingNewlines(String(node.attrs?.source ?? "")),
});
