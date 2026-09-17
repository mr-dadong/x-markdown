import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import HtmlBlockView from "./HtmlBlockView.vue";
import { writeMarkdownBlock } from "../shared/markdownRuleUtils";

const configuredParsers = new WeakSet<MarkdownIt>();

// 独占一行的单个 img 属于图片内容，不需要套用通用 HTML iframe 预览。
const isStandaloneImageHtml = (source: string): boolean =>
  /^\s*<img\b[^>]*>\s*$/iu.test(source);

interface HtmlBlockOptions {
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

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          // 原始 HTML 不做格式化，避免所见即所得视图改写用户的标签和属性。
          writeMarkdownBlock(state, node, String(node.attrs.source));
        },
        parse: {
          setup(markdown: MarkdownIt) {
            if (configuredParsers.has(markdown)) return;
            configuredParsers.add(markdown);

            // 将 HTML 块转为专用占位节点，源码只作为文本传入，绝不在编辑器中直接执行。
            markdown.renderer.rules.html_block = (tokens: Token[], index: number) => {
              const source = tokens[index].content;
              // 包进段落后交给图片扩展解析，width/height 等属性会进入图片节点。
              if (isStandaloneImageHtml(source)) return `<p>${source.trim()}</p>`;
              return `<pre data-xmd-html-block>${markdown.utils.escapeHtml(source)}</pre>`;
            };
          },
        },
      },
    };
  },
});
