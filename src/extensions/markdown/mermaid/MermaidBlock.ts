import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import { VueNodeViewRenderer } from "@tiptap/vue-3";
import MermaidBlockView from "./MermaidBlockView.vue";
import { withSingleTrailingNewline, writeMarkdownBlock } from "../shared/markdownRuleUtils";

const configuredParsers = new WeakSet<MarkdownIt>();

export const MermaidBlock = Node.create({
  name: "mermaidBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      source: { default: "graph TD\n  A[开始] --> B[结束]" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre[data-xmd-mermaid]",
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
        "data-xmd-mermaid": "",
        class: "my-4 overflow-x-auto rounded-md border border-line bg-toolbar p-3 font-mono text-[13px] text-secondary",
      }),
      String(source ?? ""),
    ];
  },

  addNodeView() {
    return VueNodeViewRenderer(MermaidBlockView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const source = withSingleTrailingNewline(String(node.attrs.source));
          writeMarkdownBlock(state, node, `\`\`\`mermaid\n${source}\`\`\``);
        },
        parse: {
          setup(markdown: MarkdownIt) {
            if (configuredParsers.has(markdown)) return;
            configuredParsers.add(markdown);

            const renderFence = markdown.renderer.rules.fence?.bind(markdown.renderer.rules);
            markdown.renderer.rules.fence = (tokens, index, options, environment, renderer) => {
              const token = tokens[index];
              if (token.info.trim().split(/\s+/u, 1)[0].toLocaleLowerCase() !== "mermaid") {
                return renderFence
                  ? renderFence(tokens, index, options, environment, renderer)
                  : renderer.renderToken(tokens, index, options);
              }

              return `<pre data-xmd-mermaid>${markdown.utils.escapeHtml(token.content)}</pre>`;
            };
          },
        },
      },
    };
  },
});
