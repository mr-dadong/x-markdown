import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import HtmlBlockView from "./HtmlBlockView.vue";
import { writeMarkdownBlock } from "../shared/markdownRuleUtils";

const configuredParsers = new WeakSet<MarkdownIt>();

export const HtmlBlock = Node.create({
  name: "htmlBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

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
            markdown.renderer.rules.html_block = (tokens: Token[], index: number) =>
              `<pre data-xmd-html-block>${markdown.utils.escapeHtml(tokens[index].content)}</pre>`;
          },
        },
      },
    };
  },
});
